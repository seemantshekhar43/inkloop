import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInkloopServer } from "./create-server.js";
import type { ServerConfig } from "./config.js";
import { hashArtifactPath, openOrResumeSession } from "../shared/session-store.js";

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0, // OS-assigned ephemeral port, keeps tests parallel-safe
    allowedHosts: [],
    idleTimeoutMs: 0,
    trustProxy: false,
    ...overrides,
  };
}

function request(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: raw ? (JSON.parse(raw) as unknown) : undefined });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

void test("GET /health returns 200 with an allowed Host header", async () => {
  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    const { status, body } = await request(port, "/health", { host: "127.0.0.1" });
    assert.equal(status, 200);
    assert.deepEqual(body, { status: "ok", service: "inkloop" });
  } finally {
    await instance.close();
  }
});

void test("rejects a request with a disallowed Host header (403), before any route runs", async () => {
  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    const { status, body } = await request(port, "/health", { host: "attacker.example" });
    assert.equal(status, 403);
    assert.deepEqual(body, { error: "invalid_host", message: "Host header not allowed" });
  } finally {
    await instance.close();
  }
});

void test("ignores X-Forwarded-Host by default (trustProxy: false)", async () => {
  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    const rejected = await request(port, "/health", {
      host: "127.0.0.1",
      "x-forwarded-host": "attacker.example",
    });
    assert.equal(rejected.status, 200); // x-forwarded-host ignored, real Host header is allowed

    const stillRejected = await request(port, "/health", {
      host: "attacker.example",
      "x-forwarded-host": "127.0.0.1", // ignored: cannot be used to bypass Host validation
    });
    assert.equal(stillRejected.status, 403);
  } finally {
    await instance.close();
  }
});

void test("validates X-Forwarded-Host instead of Host when trustProxy is true", async () => {
  const instance = createInkloopServer(baseConfig({ trustProxy: true }));
  const port = await instance.listening;
  try {
    const rejected = await request(port, "/health", {
      host: "127.0.0.1",
      "x-forwarded-host": "attacker.example",
    });
    assert.equal(rejected.status, 403);

    const allowed = await request(port, "/health", {
      host: "attacker.example", // ignored: x-forwarded-host takes precedence when trustProxy is true
      "x-forwarded-host": "127.0.0.1",
    });
    assert.equal(allowed.status, 200);
  } finally {
    await instance.close();
  }
});

void test("unknown routes return 404", async () => {
  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    const { status } = await request(port, "/nope", { host: "127.0.0.1" });
    assert.equal(status, 404);
  } finally {
    await instance.close();
  }
});

function requestRaw(
  port: number,
  urlPath: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

void test("session routes: shell, artifact content, unknown session, and a deleted artifact file", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-create-server-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-create-server-test-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot; // create-server always reads the env default

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>real artifact content</p>", "utf8");

  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    const { record } = await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    const shell = await requestRaw(port, `/session/${hash}`, { host: "127.0.0.1" });
    assert.equal(shell.status, 200);
    assert.match(shell.body, /<iframe/);
    assert.match(shell.body, new RegExp(`/session/${hash}/artifact`));

    const artifact = await requestRaw(port, `/session/${hash}/artifact`, { host: "127.0.0.1" });
    assert.equal(artifact.status, 200);
    assert.match(artifact.body, /real artifact content/);

    const unknownHash = "0".repeat(16);
    const unknown = await requestRaw(port, `/session/${unknownHash}`, { host: "127.0.0.1" });
    assert.equal(unknown.status, 404);

    await rm(record.filePath);
    const missingArtifact = await requestRaw(port, `/session/${hash}/artifact`, { host: "127.0.0.1" });
    assert.equal(missingArtifact.status, 404);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("idle timeout closes the server and invokes the callback", async () => {
  let idleFired = false;
  const instance = createInkloopServer(baseConfig({ idleTimeoutMs: 1 }), () => {
    idleFired = true;
  });
  await instance.listening;

  await new Promise<void>((resolve) => {
    instance.server.on("close", resolve);
  });

  assert.equal(idleFired, true);
});
