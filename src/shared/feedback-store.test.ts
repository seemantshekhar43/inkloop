import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendFeedback, readFeedback, readPendingFeedback, takePendingFeedback } from "./feedback-store.js";
import type { FeedbackItem } from "./feedback.js";

async function tempStateRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "inkloop-feedback-store-test-"));
}

function item(id: string): FeedbackItem {
  return {
    id,
    target: { kind: "general" },
    comment: `comment ${id}`,
    createdAt: new Date().toISOString(),
  };
}

void test("readFeedback returns an empty array when nothing has been queued", async () => {
  const stateRoot = await tempStateRoot();
  assert.deepEqual(await readFeedback("0".repeat(16), stateRoot), []);
});

void test("appendFeedback persists items and readFeedback reads them back", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "a".repeat(16);

  const firstItem = item("1");
  const first = await appendFeedback(hash, [firstItem], stateRoot);
  assert.deepEqual(first, [firstItem]);

  const combined = await appendFeedback(hash, [item("2"), item("3")], stateRoot);
  assert.deepEqual(
    combined.map((i) => i.id),
    ["1", "2", "3"],
  );

  const read = await readFeedback(hash, stateRoot);
  assert.deepEqual(
    read.map((i) => i.id),
    ["1", "2", "3"],
  );
});

void test("appendFeedback keeps sessions with different hashes isolated", async () => {
  const stateRoot = await tempStateRoot();
  await appendFeedback("b".repeat(16), [item("x")], stateRoot);
  await appendFeedback("c".repeat(16), [item("y")], stateRoot);

  assert.deepEqual(
    (await readFeedback("b".repeat(16), stateRoot)).map((i) => i.id),
    ["x"],
  );
  assert.deepEqual(
    (await readFeedback("c".repeat(16), stateRoot)).map((i) => i.id),
    ["y"],
  );
});

void test("takePendingFeedback claims only undelivered items and is idempotent on an empty queue", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "d".repeat(16);
  assert.deepEqual(await takePendingFeedback(hash, stateRoot), []);

  await appendFeedback(hash, [item("1"), item("2")], stateRoot);
  const claimed = await takePendingFeedback(hash, stateRoot);
  assert.deepEqual(
    claimed.map((i) => i.id),
    ["1", "2"],
  );
  assert.ok(claimed.every((i) => typeof i.deliveredAt === "string"));

  // Already delivered — a second poll gets nothing new, even though the items still exist on
  // disk for history.
  assert.deepEqual(await takePendingFeedback(hash, stateRoot), []);
  assert.equal((await readFeedback(hash, stateRoot)).length, 2);
});

void test("readPendingFeedback and takePendingFeedback only ever see items queued after the last delivery", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "e".repeat(16);

  await appendFeedback(hash, [item("1")], stateRoot);
  await takePendingFeedback(hash, stateRoot);
  assert.deepEqual(await readPendingFeedback(hash, stateRoot), []);

  await appendFeedback(hash, [item("2")], stateRoot);
  const pending = await readPendingFeedback(hash, stateRoot);
  assert.deepEqual(
    pending.map((i) => i.id),
    ["2"],
  );

  const claimed = await takePendingFeedback(hash, stateRoot);
  assert.deepEqual(
    claimed.map((i) => i.id),
    ["2"],
  );
});
