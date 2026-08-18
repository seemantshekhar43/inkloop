import { test, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createInkloopServer } from "../../src/server/create-server.js";
import type { ServerConfig } from "../../src/server/config.js";
import {
  hashArtifactPath,
  openOrResumeSession,
  readSessionRecord,
} from "../../src/shared/session-store.js";
import {
  appendFeedback,
  readFeedback,
  takePendingFeedback,
} from "../../src/shared/feedback-store.js";
import { readAgentReplies } from "../../src/shared/agent-reply-store.js";

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0, // OS-assigned ephemeral port, keeps tests parallel-safe
    allowedHosts: [],
    idleTimeoutMs: 0,
    trustProxy: false,
    pollTimeoutMs: 30_000,
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
    // Live reload (issue #8): scroll reporting and draft-state restoration made it into the
    // compiled bundle, not just the TypeScript source.
    assert.match(body, /inkloop:scroll/);
    assert.match(body, /inkloop:restore-draft/);
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

void test("poll route: returns immediately when feedback is already queued, and empty items on timeout", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-route-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-route-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  // Short pollTimeoutMs so the timeout branch below doesn't slow the suite down.
  const instance = createInkloopServer(baseConfig({ pollTimeoutMs: 200 }));
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    await appendFeedback(hash, [
      {
        id: "item-1",
        target: { kind: "general" },
        comment: "already queued",
        createdAt: new Date().toISOString(),
      },
    ]);

    const start = Date.now();
    const withItems = await request(port, `/session/${hash}/poll`, { host: "127.0.0.1" });
    assert.equal(withItems.status, 200);
    assert.ok(Date.now() - start < 200); // returned promptly, not after waiting out the timeout
    const body = withItems.body as { items: Array<{ id: string; deliveredAt?: string }> };
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]?.id, "item-1");
    assert.ok(body.items[0]?.deliveredAt);

    // Already delivered — a second poll times out empty instead of redelivering it.
    const timedOut = await request(port, `/session/${hash}/poll`, { host: "127.0.0.1" });
    assert.equal(timedOut.status, 200);
    assert.deepEqual(timedOut.body, { items: [] });

    const unknownHash = "0".repeat(16);
    const missing = await request(port, `/session/${unknownHash}/poll`, { host: "127.0.0.1" });
    assert.equal(missing.status, 404);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("poll route: a feedback POST that arrives mid-wait is picked up before the timeout", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-midwait-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-midwait-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig({ pollTimeoutMs: 3000 }));
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    const pollPromise = request(port, `/session/${hash}/poll`, { host: "127.0.0.1" });
    setTimeout(() => {
      void postJson(port, `/session/${hash}/feedback`, [
        {
          id: "late-item",
          target: { kind: "general" },
          comment: "arrived mid-wait",
          createdAt: new Date().toISOString(),
        },
      ]);
    }, 400);

    const start = Date.now();
    const { status, body } = await pollPromise;
    assert.equal(status, 200);
    assert.ok(Date.now() - start < 3000); // picked up well before the 3s timeout
    const items = (body as { items: Array<{ id: string }> }).items;
    assert.deepEqual(
      items.map((i) => i.id),
      ["late-item"],
    );
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("agent-reply route: valid message is accepted and persisted, unknown session 404s, invalid message 400s", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-agent-reply-route-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-agent-reply-route-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    const { status, body } = await postJson(port, `/session/${hash}/agent-reply`, {
      message: "revised the layout per feedback",
    });
    assert.equal(status, 201);
    assert.equal(
      (body as { reply: { message: string } }).reply.message,
      "revised the layout per feedback",
    );

    const stored = await readAgentReplies(hash, stateRoot);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.message, "revised the layout per feedback");

    const invalid = await postJson(port, `/session/${hash}/agent-reply`, { message: "  " });
    assert.equal(invalid.status, 400);

    const unknownHash = "0".repeat(16);
    const missing = await postJson(port, `/session/${unknownHash}/agent-reply`, { message: "hi" });
    assert.equal(missing.status, 404);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("history route: groups sent rounds with their agent replies, unknown session 404s", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-history-route-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-history-route-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    // Empty history before anything is sent.
    const empty = await request(port, `/session/${hash}/history`);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { rounds: [], commentCount: 0 });

    // Round 1: one annotation sent, then the agent replies to it.
    await appendFeedback(hash, [
      {
        id: "a1",
        target: { kind: "general" },
        comment: "fix the header",
        createdAt: new Date().toISOString(),
      },
    ]);
    // The agent reply's round is pinned to the highest *delivered* round (see
    // agent-reply-store.ts's appendAgentReply) — an agent has to have polled round 1 first,
    // same as it would via `inkloop poll`, for the reply to attach to that round.
    await takePendingFeedback(hash, stateRoot);
    await postJson(port, `/session/${hash}/agent-reply`, { message: "fixed the header" });

    // Round 2: a second annotation, no reply yet.
    await appendFeedback(hash, [
      {
        id: "a2",
        target: { kind: "general" },
        comment: "tighten spacing",
        createdAt: new Date().toISOString(),
      },
    ]);

    const { status, body } = await request(port, `/session/${hash}/history`);
    assert.equal(status, 200);
    const history = body as {
      rounds: { round: number; items: { id: string }[]; reply?: { message: string } }[];
      commentCount: number;
    };
    assert.equal(history.commentCount, 2);
    assert.equal(history.rounds.length, 2);
    assert.equal(history.rounds[0]?.round, 1);
    assert.equal(history.rounds[0]?.items[0]?.id, "a1");
    assert.equal(history.rounds[0]?.reply?.message, "fixed the header");
    assert.equal(history.rounds[1]?.round, 2);
    assert.equal(history.rounds[1]?.items[0]?.id, "a2");
    assert.equal(history.rounds[1]?.reply, undefined);

    const unknownHash = "0".repeat(16);
    const missing = await request(port, `/session/${unknownHash}/history`);
    assert.equal(missing.status, 404);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("drift route: flags matching ids as drifted, unknown session 404s, invalid body 400s", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-drift-route-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-drift-route-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    await appendFeedback(hash, [
      {
        id: "f1",
        target: { kind: "text-range", selector: "p", fingerprint: "abc123" },
        comment: "this passage moved",
        createdAt: new Date().toISOString(),
      },
    ]);

    const { status, body } = await postJson(port, `/session/${hash}/drift`, { ids: ["f1"] });
    assert.equal(status, 200);
    assert.equal((body as { drifted: number }).drifted, 1);

    const stored = await readFeedback(hash, stateRoot);
    assert.equal(stored[0]?.drifted, true);

    const invalid = await postJson(port, `/session/${hash}/drift`, { ids: [] });
    assert.equal(invalid.status, 400);

    const unknownHash = "0".repeat(16);
    const missing = await postJson(port, `/session/${unknownHash}/drift`, { ids: ["f1"] });
    assert.equal(missing.status, 404);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("reload route: times out at the current version with no change, and picks up a file write mid-wait", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-reload-route-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-reload-route-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>v1</p>", "utf8");

  const instance = createInkloopServer(baseConfig({ pollTimeoutMs: 800 }));
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    const timedOut = await request(port, `/session/${hash}/reload?since=0`, { host: "127.0.0.1" });
    assert.equal(timedOut.status, 200);
    assert.deepEqual(timedOut.body, { version: 0, otherTabActive: false });

    const reloadPromise = request(port, `/session/${hash}/reload?since=0`, { host: "127.0.0.1" });
    setTimeout(() => {
      void writeFile(artifactPath, "<p>v2</p>", "utf8");
    }, 100);

    const start = Date.now();
    const { status, body } = await reloadPromise;
    assert.equal(status, 200);
    assert.ok(Date.now() - start < 800); // resolved on the change, not the timeout
    assert.equal((body as { version: number }).version, 1);

    const unknownHash = "0".repeat(16);
    const missing = await request(port, `/session/${unknownHash}/reload?since=0`, {
      host: "127.0.0.1",
    });
    assert.equal(missing.status, 404);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("reload route: flags otherTabActive once a second tab's ?tab= id is seen, and stays unflagged for a single tab (issue #40)", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-tab-presence-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-tab-presence-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>v1</p>", "utf8");

  // A short pollTimeoutMs (each unchanged-artifact reload call blocks for the full timeout) kept
  // well under the tracker's 3x-pollTimeoutMs staleness window (see create-server.ts), so the two
  // sequential round trips below can't accidentally push the first tab's record past staleness.
  const instance = createInkloopServer(baseConfig({ pollTimeoutMs: 150 }));
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    // A lone tab never sees the banner.
    const solo = await request(port, `/session/${hash}/reload?since=0&tab=tab-a`, {
      host: "127.0.0.1",
    });
    assert.equal((solo.body as { otherTabActive: boolean }).otherTabActive, false);

    // A second tab id shows up: it sees the first tab immediately.
    const secondTabSees = await request(port, `/session/${hash}/reload?since=0&tab=tab-b`, {
      host: "127.0.0.1",
    });
    assert.equal((secondTabSees.body as { otherTabActive: boolean }).otherTabActive, true);

    // A pre-#40 client with no ?tab= at all is unaffected either way — no crash, no false flag.
    const noTabParam = await request(port, `/session/${hash}/reload?since=0`, {
      host: "127.0.0.1",
    });
    assert.equal((noTabParam.body as { otherTabActive: boolean }).otherTabActive, false);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("tab-leave route: releases a tab's presence immediately instead of waiting for it to go stale (issue #65)", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-tab-leave-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-tab-leave-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>v1</p>", "utf8");

  const instance = createInkloopServer(baseConfig({ pollTimeoutMs: 150 }));
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    await request(port, `/session/${hash}/reload?since=0&tab=tab-a`, { host: "127.0.0.1" });
    const beforeLeave = await request(port, `/session/${hash}/reload?since=0&tab=tab-b`, {
      host: "127.0.0.1",
    });
    assert.equal((beforeLeave.body as { otherTabActive: boolean }).otherTabActive, true);

    const leave = await postJson(
      port,
      `/session/${hash}/tab-leave`,
      { tabId: "tab-a" },
      { host: "127.0.0.1" },
    );
    assert.equal(leave.status, 204);

    const afterLeave = await request(port, `/session/${hash}/reload?since=0&tab=tab-b`, {
      host: "127.0.0.1",
    });
    assert.equal((afterLeave.body as { otherTabActive: boolean }).otherTabActive, false);

    // A malformed/empty beacon body is a harmless no-op, not a 4xx/5xx — the page is unloading,
    // nothing could react to an error response anyway.
    const malformed = await postJson(
      port,
      `/session/${hash}/tab-leave`,
      { tabId: 123 },
      { host: "127.0.0.1" },
    );
    assert.equal(malformed.status, 204);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("end route: ends the session as user-ended and returns next_step guidance, unknown session 404s", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-end-route-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-end-route-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig());
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    const { status, body } = await postJson(port, `/session/${hash}/end`, {});
    assert.equal(status, 200);
    const parsed = body as { status: string; endedBy: string; next_step: string };
    assert.equal(parsed.status, "ended");
    assert.equal(parsed.endedBy, "user");
    assert.match(parsed.next_step, /refuse to reopen/);

    const record = await readSessionRecord(artifactPath, stateRoot);
    assert.equal(record?.status, "user-ended");

    const unknownHash = "0".repeat(16);
    const missing = await postJson(port, `/session/${unknownHash}/end`, {});
    assert.equal(missing.status, 404);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("shutdown route: responds then closes the server and invokes onStop with reason 'shutdown'", async () => {
  let stopReason: string | undefined;
  const instance = createInkloopServer(baseConfig(), (reason) => {
    stopReason = reason;
  });
  const port = await instance.listening;

  const { status, body } = await postJson(port, "/shutdown", {});
  assert.equal(status, 200);
  assert.deepEqual(body, { status: "stopping" });

  // Poll for the server actually going away rather than waiting on the http.Server "close"
  // event directly: that event only fires once every open connection ends, and the client
  // socket that just carried the /shutdown request/response may still be lingering in the
  // Node http.Agent's keep-alive pool at this point.
  const deadline = Date.now() + 5000;
  let stillUp = true;
  while (stillUp) {
    try {
      await request(port, "/health");
    } catch {
      stillUp = false;
      break;
    }
    if (Date.now() > deadline) throw new Error("server still accepting connections after 5s");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(stopReason, "shutdown");
});

void test("poll route: an already-ended session returns the ended shape immediately instead of waiting out the timeout", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-ended-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-ended-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig({ pollTimeoutMs: 5000 }));
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);
    await postJson(port, `/session/${hash}/end`, {});

    const start = Date.now();
    const { status, body } = await request(port, `/session/${hash}/poll`, { host: "127.0.0.1" });
    assert.equal(status, 200);
    assert.ok(Date.now() - start < 5000); // returned immediately, not after the 5s timeout
    const parsed = body as { items: unknown[]; ended: boolean; endedBy: string; next_step: string };
    assert.deepEqual(parsed.items, []);
    assert.equal(parsed.ended, true);
    assert.equal(parsed.endedBy, "user");
    assert.match(parsed.next_step, /refuse to reopen/);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});

void test("poll route: a session ended mid-wait resolves immediately with the final pending batch plus ended/next_step", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-end-midwait-test-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-end-midwait-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;

  const artifactPath = path.join(artifactDir, "artifact.html");
  await writeFile(artifactPath, "<p>hi</p>", "utf8");

  const instance = createInkloopServer(baseConfig({ pollTimeoutMs: 3000 }));
  const port = await instance.listening;
  try {
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    // Poll starts against an empty queue, so it's genuinely waiting (in its sleep loop) when
    // both the final feedback batch and the end both land shortly after — exercising the
    // "pending items arrive in the same loop iteration the session ends" branch.
    const pollPromise = request(port, `/session/${hash}/poll`, { host: "127.0.0.1" });
    setTimeout(() => {
      void postJson(port, `/session/${hash}/feedback`, [
        {
          id: "final-item",
          target: { kind: "general" },
          comment: "last one before ending",
          createdAt: new Date().toISOString(),
        },
      ]);
      void postJson(port, `/session/${hash}/end`, {});
    }, 50);

    const start = Date.now();
    const { status, body } = await pollPromise;
    assert.equal(status, 200);
    assert.ok(Date.now() - start < 3000);
    const parsed = body as {
      items: Array<{ id: string }>;
      ended?: boolean;
      endedBy?: string;
      next_step?: string;
    };
    assert.deepEqual(
      parsed.items.map((i) => i.id),
      ["final-item"],
    );
    assert.equal(parsed.ended, true);
    assert.equal(parsed.endedBy, "user");
    assert.match(parsed.next_step ?? "", /refuse to reopen/);
  } finally {
    await instance.close();
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});
