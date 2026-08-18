import { test } from "node:test";
import assert from "node:assert/strict";
import { createTabPresenceTracker } from "../../src/server/tab-presence.js";

void test("a single tab never sees itself as another tab", () => {
  const tracker = createTabPresenceTracker(10_000);
  let now = 0;
  assert.equal(tracker.record("hash-1", "tab-a", now), false);
  now += 1000;
  assert.equal(tracker.record("hash-1", "tab-a", now), false);
});

void test("a second tab id is flagged both ways once seen", () => {
  const tracker = createTabPresenceTracker(10_000);
  let now = 0;
  assert.equal(tracker.record("hash-1", "tab-a", now), false);
  now += 500;
  assert.equal(tracker.record("hash-1", "tab-b", now), true);
  now += 500;
  assert.equal(tracker.record("hash-1", "tab-a", now), true);
});

void test("a stale tab drops out and the flag clears", () => {
  const tracker = createTabPresenceTracker(1000);
  let now = 0;
  tracker.record("hash-1", "tab-a", now);
  now += 500;
  assert.equal(tracker.record("hash-1", "tab-b", now), true);
  // tab-a goes quiet past the staleness window; only tab-b keeps polling.
  now += 2000;
  assert.equal(tracker.record("hash-1", "tab-b", now), false);
});

void test("different sessions (hashes) never see each other's tabs", () => {
  const tracker = createTabPresenceTracker(10_000);
  const now = 0;
  assert.equal(tracker.record("hash-1", "tab-a", now), false);
  assert.equal(tracker.record("hash-2", "tab-b", now), false);
});

void test("issue #65: release() drops a tab immediately, before it would otherwise go stale", () => {
  const tracker = createTabPresenceTracker(10_000);
  let now = 0;
  assert.equal(tracker.record("hash-1", "tab-a", now), false);
  now += 100;
  assert.equal(tracker.record("hash-1", "tab-b", now), true);

  tracker.release("hash-1", "tab-a");
  now += 100;
  assert.equal(tracker.record("hash-1", "tab-b", now), false);
});

void test("release() on an unknown hash or tab id is a harmless no-op", () => {
  const tracker = createTabPresenceTracker(10_000);
  assert.equal(tracker.record("hash-1", "tab-a", 0), false);
  tracker.release("hash-1", "tab-nonexistent");
  tracker.release("hash-nonexistent", "tab-a");
  assert.equal(tracker.record("hash-1", "tab-a", 100), false);
});
