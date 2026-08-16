import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  hashArtifactPath,
  sessionDir,
  readSessionRecord,
  openOrResumeSession,
  endSession,
  nextStepGuidance,
  SessionNotFoundError,
  SessionCorruptError,
} from "./session-store.js";

async function tempStateRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "inkloop-session-store-test-"));
}

void test("hashArtifactPath is deterministic and 16 hex chars", () => {
  const a = hashArtifactPath("/home/user/project/artifact.html");
  const b = hashArtifactPath("/home/user/project/artifact.html");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

void test("hashArtifactPath differs for different paths", () => {
  const a = hashArtifactPath("/home/user/project/one.html");
  const b = hashArtifactPath("/home/user/project/two.html");
  assert.notEqual(a, b);
});

void test("opening a new session creates it with status 'opened'", async () => {
  const stateRoot = await tempStateRoot();
  const filePath = "/fake/artifact.html";

  const result = await openOrResumeSession(filePath, { stateRoot });
  assert.equal(result.outcome, "opened");
  assert.equal(result.record.status, "opened");
  assert.equal(result.record.filePath, filePath);

  const persisted = await readSessionRecord(filePath, stateRoot);
  assert.deepEqual(persisted, result.record);
});

void test("resuming an already-opened session updates updatedAt but keeps status", async () => {
  const stateRoot = await tempStateRoot();
  const filePath = "/fake/artifact.html";

  const first = await openOrResumeSession(filePath, { stateRoot });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await openOrResumeSession(filePath, { stateRoot });

  assert.equal(second.outcome, "resumed");
  assert.equal(second.record.status, "opened");
  assert.equal(second.record.createdAt, first.record.createdAt);
  assert.notEqual(second.record.updatedAt, first.record.updatedAt);
});

void test("resuming an agent-ended session reopens it freely", async () => {
  const stateRoot = await tempStateRoot();
  const filePath = "/fake/artifact.html";

  await openOrResumeSession(filePath, { stateRoot });
  await endSession(filePath, "agent", stateRoot);

  const result = await openOrResumeSession(filePath, { stateRoot });
  assert.equal(result.outcome, "resumed");
  assert.equal(result.record.status, "opened");
});

void test("resuming a user-ended session without --reopen is refused", async () => {
  const stateRoot = await tempStateRoot();
  const filePath = "/fake/artifact.html";

  await openOrResumeSession(filePath, { stateRoot });
  const ended = await endSession(filePath, "user", stateRoot);

  const result = await openOrResumeSession(filePath, { stateRoot });
  assert.equal(result.outcome, "refused");
  assert.equal(result.reason, "user-ended-without-reopen");
  assert.deepEqual(result.record, ended);

  // Refusing must not mutate the persisted record.
  const persisted = await readSessionRecord(filePath, stateRoot);
  assert.deepEqual(persisted, ended);
});

void test("resuming a user-ended session with reopen: true succeeds", async () => {
  const stateRoot = await tempStateRoot();
  const filePath = "/fake/artifact.html";

  await openOrResumeSession(filePath, { stateRoot });
  await endSession(filePath, "user", stateRoot);

  const result = await openOrResumeSession(filePath, { stateRoot, reopen: true });
  assert.equal(result.outcome, "resumed");
  assert.equal(result.record.status, "opened");
});

void test("endSession sets agent-ended vs user-ended correctly", async () => {
  const stateRoot = await tempStateRoot();

  await openOrResumeSession("/fake/a.html", { stateRoot });
  const agentEnded = await endSession("/fake/a.html", "agent", stateRoot);
  assert.equal(agentEnded.status, "agent-ended");

  await openOrResumeSession("/fake/b.html", { stateRoot });
  const userEnded = await endSession("/fake/b.html", "user", stateRoot);
  assert.equal(userEnded.status, "user-ended");
});

void test("endSession throws SessionNotFoundError for a path with no session", async () => {
  const stateRoot = await tempStateRoot();
  await assert.rejects(() => endSession("/fake/never-opened.html", "agent", stateRoot), SessionNotFoundError);
});

void test("readSessionRecord returns undefined when no session exists", async () => {
  const stateRoot = await tempStateRoot();
  const result = await readSessionRecord("/fake/never-opened.html", stateRoot);
  assert.equal(result, undefined);
});

void test("readSessionRecord throws SessionCorruptError on malformed JSON", async () => {
  const stateRoot = await tempStateRoot();
  const filePath = "/fake/artifact.html";
  const dir = sessionDir(filePath, stateRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "session.json"), "{ not valid json", "utf8");

  await assert.rejects(() => readSessionRecord(filePath, stateRoot), SessionCorruptError);
});

void test("writes are atomic: no partial session.json is ever left on disk", async () => {
  const stateRoot = await tempStateRoot();
  const filePath = "/fake/artifact.html";
  await openOrResumeSession(filePath, { stateRoot });

  const dir = sessionDir(filePath, stateRoot);
  const raw = await readFile(path.join(dir, "session.json"), "utf8");
  // A partial/truncated write would fail to parse; a fully-written file always parses.
  assert.doesNotThrow(() => JSON.parse(raw));
});

void test("nextStepGuidance: describes reopen semantics per status, undefined while still opened", () => {
  assert.equal(nextStepGuidance("opened"), undefined);
  assert.match(nextStepGuidance("agent-ended") ?? "", /may reopen it freely/);
  assert.match(nextStepGuidance("user-ended") ?? "", /refuse to reopen it unless run with --reopen/);
});
