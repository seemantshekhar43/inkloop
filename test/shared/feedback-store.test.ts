import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendFeedback,
  claimPendingFeedback,
  commitDeliveredFeedback,
  markFeedbackDrifted,
  readFeedback,
  readPendingFeedback,
  takePendingFeedback,
} from "../../src/shared/feedback-store.js";
import type { FeedbackItem } from "../../src/shared/feedback.js";

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
  assert.deepEqual(first, [{ ...firstItem, round: 1 }]);

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

void test("appendFeedback assigns one round number per batch, incrementing session-wide", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "f".repeat(16);

  const first = await appendFeedback(hash, [item("1"), item("2")], stateRoot);
  assert.deepEqual(
    first.map((i) => i.round),
    [1, 1],
  );

  const second = await appendFeedback(hash, [item("3")], stateRoot);
  assert.deepEqual(
    second.map((i) => i.round),
    [1, 1, 2],
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

void test("claimPendingFeedback hides a claimed batch, and commitDeliveredFeedback makes that permanent", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "4".repeat(16);
  await appendFeedback(hash, [item("1"), item("2")], stateRoot);

  const claimed = await claimPendingFeedback(hash, stateRoot);
  assert.deepEqual(
    claimed.map((i) => i.id),
    ["1", "2"],
  );
  assert.ok(claimed.every((i) => typeof i.claimedAt === "string" && i.deliveredAt === undefined));

  // Claimed but not yet confirmed delivered: hidden from a second claim, and not deliveredAt on
  // disk yet — this is the window a poll response spends between being claimed and being flushed.
  assert.deepEqual(await claimPendingFeedback(hash, stateRoot), []);
  assert.deepEqual(await readPendingFeedback(hash, stateRoot), []);
  assert.ok((await readFeedback(hash, stateRoot)).every((i) => i.deliveredAt === undefined));

  await commitDeliveredFeedback(
    hash,
    claimed.map((i) => i.id),
    stateRoot,
  );
  const all = await readFeedback(hash, stateRoot);
  assert.ok(all.every((i) => typeof i.deliveredAt === "string"));
});

void test("issue #115: a claim that's never confirmed delivered ages out and is reclaimed instead of being lost", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "5".repeat(16);
  await appendFeedback(hash, [item("1")], stateRoot);

  // Simulate a poll response that claimed the item but never got confirmed (the process was
  // killed, the connection dropped, before commitDeliveredFeedback ran) — a tiny visibility
  // window so the test doesn't have to wait out the real 30s default.
  const claimVisibilityMs = 20;
  const firstClaim = await claimPendingFeedback(hash, stateRoot, claimVisibilityMs);
  assert.deepEqual(
    firstClaim.map((i) => i.id),
    ["1"],
  );

  // Still within the visibility window — genuinely hidden, not lost.
  assert.deepEqual(await claimPendingFeedback(hash, stateRoot, claimVisibilityMs), []);

  await new Promise((resolve) => setTimeout(resolve, claimVisibilityMs + 10));

  // The abandoned claim aged out: a fresh poll reclaims and can redeliver the same item rather
  // than it being invisible forever.
  const reclaimed = await claimPendingFeedback(hash, stateRoot, claimVisibilityMs);
  assert.deepEqual(
    reclaimed.map((i) => i.id),
    ["1"],
  );

  await commitDeliveredFeedback(hash, ["1"], stateRoot);
  assert.equal((await readFeedback(hash, stateRoot))[0]?.deliveredAt !== undefined, true);
});

void test("markFeedbackDrifted flags matching ids, is idempotent, and ignores unknown ids", async () => {
  const stateRoot = await tempStateRoot();
  const hash = "1".repeat(16);
  await appendFeedback(hash, [item("1"), item("2"), item("3")], stateRoot);

  const drifted = await markFeedbackDrifted(hash, ["1", "3", "unknown-id"], stateRoot);
  assert.deepEqual(
    drifted.map((i) => i.id),
    ["1", "3"],
  );
  assert.ok(drifted.every((i) => i.drifted === true && typeof i.driftedAt === "string"));

  const all = await readFeedback(hash, stateRoot);
  assert.deepEqual(
    all.map((i) => ({ id: i.id, drifted: i.drifted ?? false })),
    [
      { id: "1", drifted: true },
      { id: "2", drifted: false },
      { id: "3", drifted: true },
    ],
  );

  // Re-reporting an already-drifted id is a no-op: driftedAt doesn't move forward, and
  // re-reporting only unknown/already-drifted ids returns nothing newly changed.
  const firstDriftedAt = all[0]?.driftedAt;
  const second = await markFeedbackDrifted(hash, ["1"], stateRoot);
  assert.deepEqual(second, []);
  assert.equal((await readFeedback(hash, stateRoot))[0]?.driftedAt, firstDriftedAt);
});

void test("markFeedbackDrifted keeps sessions with different hashes isolated", async () => {
  const stateRoot = await tempStateRoot();
  await appendFeedback("2".repeat(16), [item("x")], stateRoot);
  await appendFeedback("3".repeat(16), [item("y")], stateRoot);

  await markFeedbackDrifted("2".repeat(16), ["x"], stateRoot);

  assert.equal((await readFeedback("2".repeat(16), stateRoot))[0]?.drifted, true);
  assert.equal((await readFeedback("3".repeat(16), stateRoot))[0]?.drifted, undefined);
});
