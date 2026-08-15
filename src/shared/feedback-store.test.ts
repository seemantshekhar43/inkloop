import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendFeedback, readFeedback } from "./feedback-store.js";
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
