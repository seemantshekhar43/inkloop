import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { runOpenCommand } from "./open.js";
import { loadServerConfig } from "../../server/config.js";
import { createInkloopServer, type InkloopServer } from "../../server/create-server.js";
import { endSession } from "../../shared/session-store.js";

type WriteFn = typeof process.stdout.write;

async function captureWrite(
  stream: NodeJS.WriteStream,
  fn: () => Promise<number>,
): Promise<{ code: number; text: string }> {
  const original: WriteFn = stream.write.bind(stream);
  let text = "";
  stream.write = (chunk: Uint8Array | string) => {
    text += chunk.toString();
    return true;
  };
  try {
    const code = await fn();
    return { code, text };
  } finally {
    stream.write = original;
  }
}

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

/**
 * Sets up an isolated environment for one test: a temp state dir, a temp artifact directory,
 * and a real inkloop server pre-started on a fixed test port so runOpenCommand's
 * ensureServerRunning() finds it already healthy instead of spawning a child process — that
 * keeps these tests fast and deterministic while still exercising real HTTP end to end.
 */
async function withTestEnvironment<T>(
  fn: (ctx: { artifactDir: string; port: number }) => Promise<T>,
): Promise<T> {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-open-test-state-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-open-test-artifact-"));
  const port = 44000 + Math.floor(Math.random() * 1000);

  const originalEnv = { ...process.env };
  process.env["INKLOOP_STATE_DIR"] = stateRoot;
  process.env["INKLOOP_HOST"] = "127.0.0.1";
  process.env["INKLOOP_PORT"] = String(port);
  process.env["INKLOOP_IDLE_TIMEOUT_MS"] = "0";

  const config = loadServerConfig();
  const instance: InkloopServer = createInkloopServer(config);
  await instance.listening;

  try {
    return await fn({ artifactDir, port });
  } finally {
    await instance.close();
    process.env = originalEnv;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
}

void test("opens a new session and prints a URL that serves the artifact", async () => {
  await withTestEnvironment(async ({ artifactDir, port }) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hello from the artifact</p>", "utf8");

    const { code, text } = await captureWrite(process.stdout, () => runOpenCommand(artifactPath));
    assert.equal(code, 0);

    const url = text.trim();
    assert.match(url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/session/[0-9a-f]{16}$`));

    const shell = await get(url);
    assert.equal(shell.status, 200);
    assert.match(shell.body, /<iframe/);

    const artifact = await get(`${url}/artifact`);
    assert.equal(artifact.status, 200);
    assert.match(artifact.body, /hello from the artifact/);
  });
});

void test("fails cleanly when the file does not exist", async () => {
  await withTestEnvironment(async ({ artifactDir }) => {
    const missing = path.join(artifactDir, "nope.html");
    const { code, text } = await captureWrite(process.stderr, () => runOpenCommand(missing));
    assert.equal(code, 1);
    assert.match(text, /file not found/);
  });
});

void test("fails cleanly for a non-HTML file", async () => {
  await withTestEnvironment(async ({ artifactDir }) => {
    const textFile = path.join(artifactDir, "notes.txt");
    await writeFile(textFile, "just text", "utf8");
    const { code, text } = await captureWrite(process.stderr, () => runOpenCommand(textFile));
    assert.equal(code, 1);
    assert.match(text, /not an HTML file/);
  });
});

void test("refuses to reopen a user-ended session without --reopen", async () => {
  await withTestEnvironment(async ({ artifactDir }) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");

    await runOpenCommand(artifactPath);
    await endSession(artifactPath, "user");

    const { code, text } = await captureWrite(process.stderr, () => runOpenCommand(artifactPath));
    assert.equal(code, 1);
    assert.match(text, /--reopen/);
  });
});

void test("reopens a user-ended session when --reopen is passed", async () => {
  await withTestEnvironment(async ({ artifactDir }) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");

    await runOpenCommand(artifactPath);
    await endSession(artifactPath, "user");

    const { code, text } = await captureWrite(process.stdout, () =>
      runOpenCommand(artifactPath, { reopen: true }),
    );
    assert.equal(code, 0);
    assert.match(text.trim(), /^http:\/\//);
  });
});
