/**
 * Feedback data model shared between the server (persistence, validation) and the injected SDK
 * (queue construction). Kept dependency-free and type-only where the SDK is concerned — see
 * sdk/index.ts's header comment for why the SDK never carries a runtime import of this file.
 */

/** How a feedback item is anchored to the artifact. "general" has no DOM anchor at all. */
export type FeedbackTargetKind = "element" | "text-range" | "general";

export interface FeedbackTarget {
  kind: FeedbackTargetKind;
  /** CSS selector path to the anchored element (or the text range's nearest element ancestor). */
  selector?: string;
  /** Character offsets of the selection within the anchor element's textContent. */
  startOffset?: number;
  endOffset?: number;
  /** The selected text itself, captured for future drift detection (issue #10). */
  quote?: string;
}

export interface FeedbackItem {
  /** Client-generated id (crypto.randomUUID() in the browser), unique within a session. */
  id: string;
  target: FeedbackTarget;
  comment: string;
  /** ISO-8601 timestamp, set by the SDK when the item was queued. */
  createdAt: string;
  /**
   * ISO-8601 timestamp set server-side (never by the client) once an `inkloop poll` call has
   * delivered this item to the agent. Undefined means still pending. See
   * shared/feedback-store.ts's takePendingFeedback — this is what lets poll return only items
   * the agent hasn't already seen, while still keeping delivered items on disk for history
   * (issue #21) instead of deleting them.
   */
  deliveredAt?: string;
}

/** Hard caps enforced on inbound feedback batches — an unauthenticated local server still
 * shouldn't accept unbounded request bodies. */
export const MAX_FEEDBACK_BATCH_SIZE = 200;
export const MAX_COMMENT_LENGTH = 10_000;
export const MAX_SELECTOR_LENGTH = 2_000;
export const MAX_QUOTE_LENGTH = 10_000;

const TARGET_KINDS: ReadonlySet<string> = new Set(["element", "text-range", "general"]);

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isValidTarget(value: unknown): value is FeedbackTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  if (typeof target["kind"] !== "string" || !TARGET_KINDS.has(target["kind"])) return false;

  if (target["selector"] !== undefined && !isNonEmptyString(target["selector"], MAX_SELECTOR_LENGTH)) {
    return false;
  }
  if (target["quote"] !== undefined && !isNonEmptyString(target["quote"], MAX_QUOTE_LENGTH)) {
    return false;
  }
  for (const key of ["startOffset", "endOffset"] as const) {
    const offset = target[key];
    if (offset !== undefined && (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0)) {
      return false;
    }
  }
  return true;
}

/** Validates a single feedback item's shape and size bounds. Used to reject malformed or
 * oversized items before they ever reach disk. */
export function isValidFeedbackItem(value: unknown): value is FeedbackItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isNonEmptyString(item["id"], 200) &&
    isNonEmptyString(item["comment"], MAX_COMMENT_LENGTH) &&
    isNonEmptyString(item["createdAt"], 100) &&
    !Number.isNaN(Date.parse(item["createdAt"])) &&
    isValidTarget(item["target"])
  );
}

/** Validates a full inbound batch: must be a non-empty array of valid items, within the size cap. */
export function isValidFeedbackBatch(value: unknown): value is FeedbackItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_FEEDBACK_BATCH_SIZE &&
    value.every(isValidFeedbackItem)
  );
}
