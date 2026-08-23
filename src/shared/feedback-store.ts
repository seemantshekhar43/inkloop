import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { defaultStateRoot, sessionDirByHash } from "./session-store.js";
import type { FeedbackItem } from "./feedback.js";

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function feedbackFile(hash: string, stateRoot: string): string {
  return path.join(sessionDirByHash(hash, stateRoot), "feedback.json");
}

/**
 * Reads the queued feedback for a session, keyed by the same hash used for session.json. Returns
 * an empty array if no feedback has ever been queued — this is the normal case, not an error.
 */
export async function readFeedback(
  hash: string,
  stateRoot: string = defaultStateRoot(),
): Promise<FeedbackItem[]> {
  const file = feedbackFile(hash, stateRoot);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return [];
    throw err;
  }
  return JSON.parse(raw) as FeedbackItem[];
}

/**
 * Appends a batch of already-validated feedback items to the session's queue, atomically
 * (write-to-temp-then-rename, same approach as session-store's writeSessionRecordAtomic) so a
 * concurrent read never observes a partially-written file. Requires the session directory to
 * already exist (i.e. a session was opened first) — callers check this via readSessionRecordByHash
 * before calling.
 */
export async function appendFeedback(
  hash: string,
  items: FeedbackItem[],
  stateRoot: string = defaultStateRoot(),
): Promise<FeedbackItem[]> {
  const dir = sessionDirByHash(hash, stateRoot);
  await mkdir(dir, { recursive: true });
  const existing = await readFeedback(hash, stateRoot);

  // Every item in one appendFeedback call came from a single browser "Send" click, so they all
  // share the next round number — see FeedbackItem.round's docstring.
  const nextRound = existing.reduce((max, item) => Math.max(max, item.round ?? 0), 0) + 1;
  const roundedItems = items.map((item) => ({ ...item, round: nextRound }));
  const combined = [...existing, ...roundedItems];

  const target = feedbackFile(hash, stateRoot);
  const tmp = path.join(dir, `.feedback.json.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(combined, null, 2), "utf8");
  await rename(tmp, target);
  return combined;
}

async function writeFeedbackAtomic(
  hash: string,
  items: FeedbackItem[],
  stateRoot: string,
): Promise<void> {
  const dir = sessionDirByHash(hash, stateRoot);
  await mkdir(dir, { recursive: true });
  const target = feedbackFile(hash, stateRoot);
  const tmp = path.join(dir, `.feedback.json.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
  await rename(tmp, target);
}

/**
 * How long a claimed-but-unconfirmed item stays hidden from readPendingFeedback/
 * claimPendingFeedback before it's treated as abandoned and becomes claimable again (issue #115).
 * A real poll response is flushed within milliseconds of being claimed, so this just needs to
 * comfortably outlast that — it's not a timeout callers wait out in the normal case, only a
 * backstop for the abnormal one (the polling process killed, the connection dropped, mid-flight).
 */
export const CLAIM_VISIBILITY_MS = 30_000;

function isVisiblyPending(item: FeedbackItem, now: number, claimVisibilityMs: number): boolean {
  if (item.deliveredAt !== undefined) return false;
  if (item.claimedAt === undefined) return true;
  return now - Date.parse(item.claimedAt) >= claimVisibilityMs;
}

/**
 * Reads only the feedback items currently available to claim: never delivered, and either never
 * claimed or claimed long enough ago (CLAIM_VISIBILITY_MS) that the claim is presumed abandoned.
 * Read-only — unlike claimPendingFeedback, this doesn't mark anything as claimed, so it's safe
 * for the poll loop's own has-anything-changed checks between requests.
 */
export async function readPendingFeedback(
  hash: string,
  stateRoot: string = defaultStateRoot(),
  claimVisibilityMs: number = CLAIM_VISIBILITY_MS,
): Promise<FeedbackItem[]> {
  const all = await readFeedback(hash, stateRoot);
  const now = Date.now();
  return all.filter((item) => isVisiblyPending(item, now, claimVisibilityMs));
}

/**
 * Atomically claims every currently-visible pending item (see readPendingFeedback) for a
 * session: marks each with a `claimedAt` timestamp and persists that back to feedback.json, then
 * returns just the batch that was newly claimed. Claiming is deliberately *not* the same as
 * delivering — see commitDeliveredFeedback — so the poll route can send the claimed batch to the
 * client and only mark it permanently `deliveredAt` once that response is confirmed flushed
 * (issue #115). Until then, the claim keeps the batch hidden from other pollers for
 * claimVisibilityMs; if the response is lost in transit and delivery is never confirmed, the
 * claim ages out and a later poll reclaims and resends the same items instead of them being lost.
 *
 * There is no cross-process locking here: appendFeedback (browser POST) and claimPendingFeedback
 * (agent poll) are both plain read-modify-write cycles. That's an accepted tradeoff for a
 * single-user local server with low write concurrency rather than a gap to close with a
 * dependency like a file lock or SQLite.
 */
export async function claimPendingFeedback(
  hash: string,
  stateRoot: string = defaultStateRoot(),
  claimVisibilityMs: number = CLAIM_VISIBILITY_MS,
): Promise<FeedbackItem[]> {
  const all = await readFeedback(hash, stateRoot);
  const now = Date.now();
  const claimedAt = new Date(now).toISOString();
  const claimed: FeedbackItem[] = [];
  const updated = all.map((item) => {
    if (!isVisiblyPending(item, now, claimVisibilityMs)) return item;
    const withClaimedAt = { ...item, claimedAt };
    claimed.push(withClaimedAt);
    return withClaimedAt;
  });
  if (claimed.length === 0) return [];
  await writeFeedbackAtomic(hash, updated, stateRoot);
  return claimed;
}

/**
 * Atomically claims every currently-undelivered feedback item and marks it `deliveredAt` in one
 * step, with no intermediate claimed-but-unconfirmed state. Not used by the poll route (see
 * claimPendingFeedback + commitDeliveredFeedback for that — issue #115's fix needs the two steps
 * kept separate so delivery can be deferred until a response is confirmed flushed); kept as a
 * direct one-shot primitive for callers that don't need that flush-confirmation window. Delivered
 * items are kept on disk (not deleted) so a full session history survives for issue #21 — only
 * the poll cursor (deliveredAt) advances.
 *
 * There is no cross-process locking here: appendFeedback (browser POST) and takePendingFeedback
 * are both plain read-modify-write cycles. That's an accepted tradeoff for a single-user local
 * server with low write concurrency rather than a gap to close with a dependency like a file
 * lock or SQLite.
 */
export async function takePendingFeedback(
  hash: string,
  stateRoot: string = defaultStateRoot(),
): Promise<FeedbackItem[]> {
  const all = await readFeedback(hash, stateRoot);
  const deliveredAt = new Date().toISOString();
  const claimed: FeedbackItem[] = [];
  const updated = all.map((item) => {
    if (item.deliveredAt !== undefined) return item;
    const withDeliveredAt = { ...item, deliveredAt };
    claimed.push(withDeliveredAt);
    return withDeliveredAt;
  });
  if (claimed.length === 0) return [];
  await writeFeedbackAtomic(hash, updated, stateRoot);
  return claimed;
}

/**
 * Marks specific feedback ids as permanently delivered, if they aren't already (issue #115).
 * Pairs with claimPendingFeedback: the poll route claims a batch (hiding it behind claimedAt),
 * sends it, and only calls this — turning claimedAt into a permanent deliveredAt — once that
 * response is confirmed flushed. If the response is lost in transit instead (the polling process
 * is killed, the connection drops) this never runs, the claim simply ages out
 * (CLAIM_VISIBILITY_MS) once it's stale, and a later poll reclaims and resends the same items
 * instead of them being lost forever. Idempotent — an id that's already delivered keeps its
 * original deliveredAt rather than being overwritten.
 */
export async function commitDeliveredFeedback(
  hash: string,
  ids: string[],
  stateRoot: string = defaultStateRoot(),
): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const all = await readFeedback(hash, stateRoot);
  const deliveredAt = new Date().toISOString();
  let changed = false;
  const updated = all.map((item) => {
    if (!idSet.has(item.id) || item.deliveredAt !== undefined) return item;
    changed = true;
    return { ...item, deliveredAt };
  });
  if (!changed) return;
  await writeFeedbackAtomic(hash, updated, stateRoot);
}

/**
 * Flags the given feedback item ids as drifted (issue #10): the browser's SDK recomputed a
 * text-range target's content fingerprint against the live artifact and found it no longer
 * matches what was captured at queue time. Idempotent — an id that's already drifted, or that
 * doesn't match any item, is left untouched, so a client can safely re-report the same id across
 * multiple artifact reloads. Persists even for already-delivered items: an agent that's about to
 * revise based on a poll response it already received can't un-see it, but a human re-opening
 * the review shell should still see the flag in the round-history panel (issue #21).
 */
export async function markFeedbackDrifted(
  hash: string,
  ids: string[],
  stateRoot: string = defaultStateRoot(),
): Promise<FeedbackItem[]> {
  const idSet = new Set(ids);
  const all = await readFeedback(hash, stateRoot);
  const driftedAt = new Date().toISOString();
  let changed = false;
  const updated = all.map((item) => {
    if (!idSet.has(item.id) || item.drifted) return item;
    changed = true;
    return { ...item, drifted: true, driftedAt };
  });
  if (!changed) return [];
  await writeFeedbackAtomic(hash, updated, stateRoot);
  return updated.filter((item) => idSet.has(item.id));
}
