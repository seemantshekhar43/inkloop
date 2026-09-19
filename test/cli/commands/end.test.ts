import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decode } from "@toon-format/toon";
import { runEndCommand } from "../../../src/cli/commands/end.js";
import { endSession, openOrResumeSession, readSessionRecord } from "../../../src/shared/session-store.js";

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

async function withTestEnvironment<T>(fn: (artifactDir: string) => Promise<T>): Promise<T> {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "inkloop-end-cmd-test-state-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "inkloop-end-cmd-test-artifact-"));
  const originalStateDir = process.env["INKLOOP_STATE_DIR"];
  process.env["INKLOOP_STATE_DIR"] = stateRoot;
  try {
    return await fn(artifactDir);
  } finally {
    process.env["INKLOOP_STATE_DIR"] = originalStateDir;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
}

void test("returns 1 with no session opened for the file", async () => {
  await withTestEnvironment(async (artifactDir) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");

    const { code, text } = await captureWrite(process.stderr, () => runEndCommand(artifactPath));
    assert.equal(code, 1);
    assert.match(text, /no session found/);
  });
});

void test("ends an opened session with status agent-ended and prints next_step guidance to stdout", async () => {
  await withTestEnvironment(async (artifactDir) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");
    // Uses session-store directly rather than the CLI's open command, which would also need a
    // live server for ensureServerRunning() — this test only needs a session record to exist.
    await openOrResumeSession(artifactPath);

    const { code, text } = await captureWrite(process.stdout, () => runEndCommand(artifactPath));
    assert.equal(code, 0);
    const body = decode(text) as { status: string; endedBy: string; next_step: string };
    assert.equal(body.status, "ended");
    assert.equal(body.endedBy, "agent");
    assert.match(body.next_step, /may reopen it freely/);

    const record = await readSessionRecord(artifactPath);
    assert.equal(record?.status, "agent-ended");
  });
});

void test("ending an already user-ended session reports endedBy: \"user\", not \"agent\"", async () => {
  await withTestEnvironment(async (artifactDir) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");
    await openOrResumeSession(artifactPath);
    // Simulate the user ending the session from the browser (POST /session/:hash/end) before
    // the agent's own belt-and-suspenders `inkloop end` call runs.
    await endSession(artifactPath, "user");

    const { code, text } = await captureWrite(process.stdout, () => runEndCommand(artifactPath));
    assert.equal(code, 0);
    const body = decode(text) as { status: string; endedBy: string; next_step: string };
    assert.equal(body.status, "ended");
    assert.equal(body.endedBy, "user");
    assert.match(body.next_step, /will refuse to reopen it unless run with --reopen/);

    const record = await readSessionRecord(artifactPath);
    assert.equal(record?.status, "user-ended");
  });
});

void test("ending an already-ended session re-ends it (endSession has no ended-guard of its own)", async () => {
  await withTestEnvironment(async (artifactDir) => {
    const artifactPath = path.join(artifactDir, "artifact.html");
    await writeFile(artifactPath, "<p>hi</p>", "utf8");
    await openOrResumeSession(artifactPath);

    const first = await captureWrite(process.stdout, () => runEndCommand(artifactPath));
    assert.equal(first.code, 0);
    const second = await captureWrite(process.stdout, () => runEndCommand(artifactPath));
    assert.equal(second.code, 0);

    const record = await readSessionRecord(artifactPath);
    assert.equal(record?.status, "agent-ended");
  });
});
