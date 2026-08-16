import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidDriftIdBatch,
  isValidFeedbackBatch,
  isValidFeedbackItem,
  MAX_DRIFT_ID_BATCH_SIZE,
  MAX_FEEDBACK_BATCH_SIZE,
  MAX_FINGERPRINT_LENGTH,
} from "./feedback.js";

function validItem(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "abc123",
    target: { kind: "element", selector: "div > p:nth-of-type(2)" },
    comment: "This should be bigger.",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

void test("accepts a well-formed element-anchored item", () => {
  assert.equal(isValidFeedbackItem(validItem()), true);
});

void test("accepts a well-formed text-range item with offsets and a quote", () => {
  const item = validItem({
    target: { kind: "text-range", selector: "p", startOffset: 3, endOffset: 12, quote: "hi there" },
  });
  assert.equal(isValidFeedbackItem(item), true);
});

void test("accepts a general item with no selector", () => {
  const item = validItem({ target: { kind: "general" } });
  assert.equal(isValidFeedbackItem(item), true);
});

void test("rejects an unknown target kind", () => {
  const item = validItem({ target: { kind: "bogus" } });
  assert.equal(isValidFeedbackItem(item), false);
});

void test("rejects an empty comment", () => {
  assert.equal(isValidFeedbackItem(validItem({ comment: "" })), false);
});

void test("rejects an oversized comment", () => {
  assert.equal(isValidFeedbackItem(validItem({ comment: "x".repeat(10_001) })), false);
});

void test("rejects a non-ISO createdAt", () => {
  assert.equal(isValidFeedbackItem(validItem({ createdAt: "not-a-date" })), false);
});

void test("rejects negative or non-integer offsets", () => {
  assert.equal(
    isValidFeedbackItem(validItem({ target: { kind: "text-range", startOffset: -1 } })),
    false,
  );
  assert.equal(
    isValidFeedbackItem(validItem({ target: { kind: "text-range", startOffset: 1.5 } })),
    false,
  );
});

void test("rejects missing or malformed target/id/comment", () => {
  assert.equal(isValidFeedbackItem(validItem({ target: undefined })), false);
  assert.equal(isValidFeedbackItem(validItem({ id: 42 })), false);
  assert.equal(isValidFeedbackItem(null), false);
  assert.equal(isValidFeedbackItem("nope"), false);
});

void test("isValidFeedbackBatch accepts a non-empty array of valid items", () => {
  assert.equal(isValidFeedbackBatch([validItem(), validItem({ id: "def456" })]), true);
});

void test("isValidFeedbackBatch rejects an empty array, a non-array, and a batch over the size cap", () => {
  assert.equal(isValidFeedbackBatch([]), false);
  assert.equal(isValidFeedbackBatch({}), false);
  assert.equal(
    isValidFeedbackBatch(Array.from({ length: MAX_FEEDBACK_BATCH_SIZE + 1 }, () => validItem())),
    false,
  );
});

void test("isValidFeedbackBatch rejects a batch containing one invalid item", () => {
  assert.equal(isValidFeedbackBatch([validItem(), { bogus: true }]), false);
});

void test("accepts a text-range item carrying a fingerprint", () => {
  const item = validItem({ target: { kind: "text-range", selector: "p", fingerprint: "1a2b3c4d" } });
  assert.equal(isValidFeedbackItem(item), true);
});

void test("rejects an oversized or empty fingerprint", () => {
  assert.equal(
    isValidFeedbackItem(
      validItem({ target: { kind: "text-range", fingerprint: "x".repeat(MAX_FINGERPRINT_LENGTH + 1) } }),
    ),
    false,
  );
  assert.equal(isValidFeedbackItem(validItem({ target: { kind: "text-range", fingerprint: "" } })), false);
});

void test("isValidDriftIdBatch accepts a non-empty array of id strings", () => {
  assert.equal(isValidDriftIdBatch(["a", "b", "c"]), true);
});

void test("isValidDriftIdBatch rejects an empty array, a non-array, a batch over the size cap, and non-string ids", () => {
  assert.equal(isValidDriftIdBatch([]), false);
  assert.equal(isValidDriftIdBatch("nope"), false);
  assert.equal(
    isValidDriftIdBatch(Array.from({ length: MAX_DRIFT_ID_BATCH_SIZE + 1 }, (_, i) => `id-${i}`)),
    false,
  );
  assert.equal(isValidDriftIdBatch(["a", 42]), false);
});
