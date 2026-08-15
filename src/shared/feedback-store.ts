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
  const combined = [...existing, ...items];

  const target = feedbackFile(hash, stateRoot);
  const tmp = path.join(dir, `.feedback.json.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(combined, null, 2), "utf8");
  await rename(tmp, target);
  return combined;
}
