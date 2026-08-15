import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPollCommand } from "./poll.js";
import { loadServerConfig } from "../../server/config.js";
import { createInkloopServer, type InkloopServer } from "../../server/create-server.js";
import { hashArtifactPath, openOrResumeSession } from "../../shared/session-store.js";
import { appendFeedback } from "../../shared/feedback-store.js";
import { readAgentReplies } from "../../shared/agent-reply-store.js";

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

/**
 * Same isolation pattern as open.test.ts: a real server pre-started on a fixed test port so
 * ensureServerRunning() finds it already healthy, plus a short pollTimeoutMs so the timeout
 * branch (exercised indirectly by the mid-wait test below) doesn't slow the suite down.
 */
async function withTestEnvironment<T>(
  fn: (ctx: { artifactDir: string; port: number }) => Promise<T>,
): Promise<T> {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-cmd-test-state-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-poll-cmd-test-artifact-"));
  const port = 45000 + Math.floor(Math.random() * 1000);

  const originalEnv = { ...process.env };
  process.env["INKLOOP_STATE_DIR"] = stateRoot;
  process.env["INKLOOP_HOST"] = "127.0.0.1";
  process.env["INKLOOP_PORT"] = String(port);
  process.env["INKLOOP_IDLE_TIMEOUT_MS"] = "0";
  process.env["INKLOOP_POLL_TIMEOUT_MS"] = "300";

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

void test("returns 1 with no session opened for the file", async () => {
  await withTestEnvironment(async ({ artifactDir }) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");

    const { code, text } = await captureWrite(process.stderr, () => runPollCommand(artifactPath));
    assert.equal(code, 1);
    assert.match(text, /no session found/);
  });
});

void test("returns queued feedback already present when the poll call is made", async () => {
  await withTestEnvironment(async ({ artifactDir }) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);
    await appendFeedback(hash, [
      {
        id: "item-1",
        target: { kind: "general" },
        comment: "pre-queued",
        createdAt: new Date().toISOString(),
      },
    ]);

    const { code, text } = await captureWrite(process.stdout, () => runPollCommand(artifactPath));
    assert.equal(code, 0);
    const items = JSON.parse(text) as Array<{ id: string; comment: string }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.comment, "pre-queued");
  });
});

void test("blocks across an empty poll round-trip and returns once feedback arrives", async () => {
  await withTestEnvironment(async ({ artifactDir }) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);

    // Arrives after the first (300ms) server-side poll round times out empty, proving the CLI
    // re-issued the request rather than giving up.
    setTimeout(() => {
      void appendFeedback(hash, [
        {
          id: "late-item",
          target: { kind: "general" },
          comment: "arrived after a timeout round",
          createdAt: new Date().toISOString(),
        },
      ]);
    }, 500);

    const { code, text } = await captureWrite(process.stdout, () => runPollCommand(artifactPath));
    assert.equal(code, 0);
    const items = JSON.parse(text) as Array<{ id: string }>;
    assert.deepEqual(
      items.map((i) => i.id),
      ["late-item"],
    );
  });
});

void test("--agent-reply posts a message before polling", async () => {
  await withTestEnvironment(async ({ artifactDir }) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");
    await openOrResumeSession(artifactPath);
    const hash = hashArtifactPath(artifactPath);
    await appendFeedback(hash, [
      {
        id: "item-1",
        target: { kind: "general" },
        comment: "next round",
        createdAt: new Date().toISOString(),
      },
    ]);

    const { code } = await captureWrite(process.stdout, () =>
      runPollCommand(artifactPath, { agentReply: "fixed the spacing issue" }),
    );
    assert.equal(code, 0);

    const replies = await readAgentReplies(hash);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]?.message, "fixed the spacing issue");
  });
});
