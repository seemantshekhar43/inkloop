import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendAgentReply,
  isValidAgentReplyMessage,
  MAX_AGENT_REPLY_LENGTH,
  readAgentReplies,
} from "../../src/shared/agent-reply-store.js";
import { appendFeedback, takePendingFeedback } from "../../src/shared/feedback-store.js";

async function tempStateRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "inkloop-agent-reply-store-test-"));
}

void test("readAgentReplies returns an empty array when nothing has been posted", async () => {
  const stateRoot = await tempStateRoot();
  assert.deepEqual(await readAgentReplies("0".repeat(16), stateRoot), []);
});

void test("appendAgentReply persists messages in order, trimmed, with generated id/timestamp", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "a".repeat(16);

  const first = await appendAgentReply(hash, "  fixed the header spacing  ", stateRoot);
  assert.equal(first.message, "fixed the header spacing");
  assert.ok(first.id);
  assert.ok(!Number.isNaN(Date.parse(first.createdAt)));

  await appendAgentReply(hash, "also fixed the footer", stateRoot);
  const all = await readAgentReplies(hash, stateRoot);
  assert.deepEqual(
    all.map((r) => r.message),
    ["fixed the header spacing", "also fixed the footer"],
  );
});

void test("appendAgentReply keeps sessions with different hashes isolated", async () => {
  const stateRoot = await tempStateRoot();
  await appendAgentReply("b".repeat(16), "reply b", stateRoot);
  await appendAgentReply("c".repeat(16), "reply c", stateRoot);

  assert.deepEqual(
    (await readAgentReplies("b".repeat(16), stateRoot)).map((r) => r.message),
    ["reply b"],
  );
  assert.deepEqual(
    (await readAgentReplies("c".repeat(16), stateRoot)).map((r) => r.message),
    ["reply c"],
  );
});

void test("appendAgentReply links the reply to the highest round delivered so far, or leaves it unset", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "d".repeat(16);

  const noFeedbackYet = await appendAgentReply(hash, "reply before any poll", stateRoot);
  assert.equal(noFeedbackYet.round, undefined);

  await appendFeedback(hash, [
    { id: "1", target: { kind: "general" }, comment: "c1", createdAt: new Date().toISOString() },
  ], stateRoot);
  const queuedNotDelivered = await appendAgentReply(hash, "reply before delivery", stateRoot);
  assert.equal(queuedNotDelivered.round, undefined);

  await takePendingFeedback(hash, stateRoot);
  const afterRoundOne = await appendAgentReply(hash, "reply after round 1", stateRoot);
  assert.equal(afterRoundOne.round, 1);

  await appendFeedback(hash, [
    { id: "2", target: { kind: "general" }, comment: "c2", createdAt: new Date().toISOString() },
  ], stateRoot);
  await takePendingFeedback(hash, stateRoot);
  const afterRoundTwo = await appendAgentReply(hash, "reply after round 2", stateRoot);
  assert.equal(afterRoundTwo.round, 2);
});

void test("isValidAgentReplyMessage rejects empty, whitespace-only, non-string, and oversized values", () => {
  assert.equal(isValidAgentReplyMessage("a real reply"), true);
  assert.equal(isValidAgentReplyMessage(""), false);
  assert.equal(isValidAgentReplyMessage("   "), false);
  assert.equal(isValidAgentReplyMessage(42), false);
  assert.equal(isValidAgentReplyMessage(undefined), false);
  assert.equal(isValidAgentReplyMessage("x".repeat(MAX_AGENT_REPLY_LENGTH + 1)), false);
  assert.equal(isValidAgentReplyMessage("x".repeat(MAX_AGENT_REPLY_LENGTH)), true);
});
