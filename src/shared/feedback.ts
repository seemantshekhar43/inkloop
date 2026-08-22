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
  /** The selected text itself, captured for drift detection (issue #10). */
  quote?: string;
  /**
   * A short content fingerprint of the anchor element's live textContent, captured by the SDK
   * at the moment the annotation was queued (see sdk/index.ts's fingerprint()). Only meaningful
   * for "text-range" targets — the browser recomputes this against the *current* DOM on every
   * artifact load/reload and, on a mismatch, reports drift back to the server (see
   * FeedbackItem.drifted below) instead of leaving the agent to resolve against stale context.
   */
  fingerprint?: string;
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
   * shared/feedback-store.ts's claimPendingFeedback/commitDeliveredFeedback — this is what lets
   * poll return only items the agent hasn't already seen, while still keeping delivered items on
   * disk for history (issue #21) instead of deleting them.
   */
  deliveredAt?: string;
  /**
   * ISO-8601 timestamp set server-side once a poll response has claimed this item but before
   * that response is confirmed to have reached the client (issue #115). A claimed item is hidden
   * from a subsequent poll only while claimedAt is recent (see feedback-store.ts's
   * CLAIM_VISIBILITY_MS) — if the response carrying it never actually arrives (the polling
   * process is killed, the connection drops) the claim ages out and the item becomes visible
   * again instead of being lost forever. Superseded by deliveredAt once the response is confirmed
   * flushed.
   */
  claimedAt?: string;
  /**
   * Server-assigned round number: all items appended together in one POST /feedback batch (one
   * browser "Send" click) share the same round, and rounds increment session-wide. Never set by
   * the client. This is the data-model groundwork issue #21 asks for alongside whichever of
   * #7/#8 lands second (#8, since #7 landed first) — a future round-history UI needs a real
   * boundary to group past annotations by, not a fabricated one. See feedback-store.ts's
   * appendFeedback for where it's assigned.
   */
  round?: number;
  /**
   * Set server-side (never by the client) once the browser has detected that this item's
   * anchored text range no longer matches the live artifact — see shared/feedback-store.ts's
   * markFeedbackDrifted and the POST /session/:hash/drift route it backs. `inkloop poll` returns
   * this flag as-is alongside the rest of the item, so the agent can ask the human to re-anchor
   * rather than guessing which passage a stale quote/offsets pair was meant to point at.
   */
  drifted?: boolean;
  /** ISO-8601 timestamp of when drift was detected, paired with `drifted`. */
  driftedAt?: string;
}

/** Hard caps enforced on inbound feedback batches — an unauthenticated local server still
 * shouldn't accept unbounded request bodies. */
export const MAX_FEEDBACK_BATCH_SIZE = 200;
export const MAX_COMMENT_LENGTH = 10_000;
export const MAX_SELECTOR_LENGTH = 2_000;
export const MAX_QUOTE_LENGTH = 10_000;
/** Fingerprints are a short hex hash (see sdk/index.ts's fingerprint()), never long-form content. */
export const MAX_FINGERPRINT_LENGTH = 32;
/** Hard cap on a single POST /session/:hash/drift body's id batch — same rationale as the
 * feedback batch cap above. */
export const MAX_DRIFT_ID_BATCH_SIZE = 200;

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
  if (
    target["fingerprint"] !== undefined &&
    !isNonEmptyString(target["fingerprint"], MAX_FINGERPRINT_LENGTH)
  ) {
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

/** Validates a POST /session/:hash/drift body: a non-empty array of feedback item ids, within
 * the size cap — the SDK's drift check (issue #10) reports every id it found mismatched in one
 * batch per artifact load/reload rather than one request per item. */
export function isValidDriftIdBatch(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_DRIFT_ID_BATCH_SIZE &&
    value.every((id) => isNonEmptyString(id, 200))
  );
}
