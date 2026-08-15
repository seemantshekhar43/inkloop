import { test, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createInkloopServer } from "./create-server.js";
import type { ServerConfig } from "./config.js";
import { hashArtifactPath, openOrResumeSession } from "../shared/session-store.js";
import { readFeedback } from "../shared/feedback-store.js";

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
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: raw ? (JSON.parse(raw) as unknown) : undefined,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// The SDK-serving and injection tests below need dist/sdk/index.js to exist. Build it once up
// front rather than requiring every test invocation to remember `npm run build` first — this
// mirrors the "npm run check" gate's job of exercising the real, built artifact end to end.
before(() => {
  execFileSync("npx", ["tsc", "-p", "src/sdk/tsconfig.json"], {
    cwd: path.resolve(import.meta.dirname, "..", ".."),
    stdio: "inherit",
  });
});

function postJson(
  port: number,
  urlPath: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: { host: "127.0.0.1", "content-type": "application/json", ...headers },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: raw ? (JSON.parse(raw) as unknown) : undefined,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
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
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
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
    // Injected at serve time only — the source file on disk is untouched (checked below).
    assert.match(artifact.body, /<script src="\/sdk\.js"><\/script>/);
    assert.equal(await readFile(artifactPath, "utf8"), "<p>real artifact content</p>");

    const unknownHash = "0".repeat(16);
    const unknown = await requestRaw(port, `/session/${unknownHash}`, { host: "127.0.0.1" });
    assert.equal(unknown.status, 404);

    await rm(record.filePath);
    const missingArtifact = await requestRaw(port, `/session/${hash}/artifact`, {
      host: "127.0.0.1",
    });
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

void test("GET /sdk.js serves the compiled SDK bundle as JavaScript, no Host bypass required for content-type", async () => {
  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    const { status, body } = await requestRaw(port, "/sdk.js", { host: "127.0.0.1" });
    assert.equal(status, 200);
    // Sanity check it's the real bundle, not a stub — it defines the IIFE and guards on being
    // hosted in an iframe.
    assert.match(body, /window === window\.parent/);
    assert.doesNotMatch(body, /^export /m);
  } finally {
    await instance.close();
  }
});

void test("feedback route: valid batch is accepted and persisted, unknown session 404s", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-feedback-route-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-feedback-route-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    const batch = [
      {
        id: "item-1",
        target: { kind: "element", selector: "p" },
        comment: "Make this bold.",
        createdAt: new Date().toISOString(),
      },
    ];

    const { status, body } = await postJson(port, `/session/${hash}/feedback`, batch);
    assert.equal(status, 201);
    assert.deepEqual(body, { queued: 1, total: 1 });

    const stored = await readFeedback(hash, stateRoot);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.comment, "Make this bold.");

    const unknownHash = "0".repeat(16);
    const missing = await postJson(port, `/session/${unknownHash}/feedback`, batch);
    assert.equal(missing.status, 404);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("feedback route: rejects malformed JSON, invalid batch shapes, and oversized bodies", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-feedback-invalid-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-feedback-invalid-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    const malformed = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/session/${hash}/feedback`,
          method: "POST",
          headers: { host: "127.0.0.1", "content-type": "application/json" },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
        },
      );
      req.on("error", reject);
      req.end("{not json");
    });
    assert.equal(malformed.status, 400);

    const emptyBatch = await postJson(port, `/session/${hash}/feedback`, []);
    assert.equal(emptyBatch.status, 400);

    const badItem = await postJson(port, `/session/${hash}/feedback`, [{ bogus: true }]);
    assert.equal(badItem.status, 400);

    const oversized = await new Promise<{ status: number }>((resolve) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/session/${hash}/feedback`,
          method: "POST",
          headers: { host: "127.0.0.1", "content-type": "application/json" },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
          res.on("error", () => resolve({ status: 0 }));
        },
      );
      req.on("error", () => resolve({ status: 0 }));
      req.write("x".repeat(3 * 1024 * 1024));
      req.end();
    });
    assert.equal(oversized.status, 413);

    // Confirm nothing from the rejected requests made it to disk.
    assert.deepEqual(await readFeedback(hash, stateRoot), []);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});
