import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createInkloopServer } from "./create-server.js";
import type { ServerConfig } from "./config.js";

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0, // OS-assigned ephemeral port, keeps tests parallel-safe
    allowedHosts: [],
    idleTimeoutMs: 0,
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
    assert.deepEqual(body, { status: "ok" });
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

void test("validates X-Forwarded-Host the same way when present", async () => {
  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    const rejected = await request(port, "/health", {
      host: "127.0.0.1",
      "x-forwarded-host": "attacker.example",
    });
    assert.equal(rejected.status, 403);

    const allowed = await request(port, "/health", {
      host: "attacker.example", // ignored: x-forwarded-host takes precedence when present
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
