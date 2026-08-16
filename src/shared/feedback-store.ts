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
 * Reads only the feedback items an `inkloop poll` call hasn't already delivered to the agent
 * (no `deliveredAt` yet). Read-only — unlike takePendingFeedback, this doesn't mark anything as
 * delivered, so it's safe for the poll loop's own has-anything-changed checks between requests.
 */
export async function readPendingFeedback(
  hash: string,
  stateRoot: string = defaultStateRoot(),
): Promise<FeedbackItem[]> {
  const all = await readFeedback(hash, stateRoot);
  return all.filter((item) => item.deliveredAt === undefined);
}

/**
 * Atomically claims every currently-pending feedback item for a session: marks each with a
 * `deliveredAt` timestamp and persists that back to feedback.json, then returns just the batch
 * that was newly claimed. Delivered items are kept on disk (not deleted) so a full session
 * history survives for issue #21 — only the poll cursor (deliveredAt) advances.
 *
 * There is no cross-process locking here: appendFeedback (browser POST) and takePendingFeedback
 * (agent poll) are both plain read-modify-write cycles. That's an accepted tradeoff for a
 * single-user local server with low write concurrency (see docs/plan.md §5) rather than a gap to
 * close with a dependency like a file lock or SQLite.
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
