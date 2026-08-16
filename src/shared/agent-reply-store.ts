import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { defaultStateRoot, sessionDirByHash } from "./session-store.js";
import { readFeedback } from "./feedback-store.js";

/**
 * A short summary an agent posts (via `inkloop poll --agent-reply`, issue #7) before polling
 * again, describing what it changed in response to the previous feedback batch. Persisted so a
 * future round-history UI (issue #21) has real "agent revised" entries to render instead of
 * needing to fabricate them.
 */
export interface AgentReply {
  id: string;
  message: string;
  /** ISO-8601 timestamp, set by the server when the reply was recorded. */
  createdAt: string;
  /**
   * The highest feedback round that had been delivered to the agent as of this reply — i.e.
   * which round of human annotations this reply is a response to. See FeedbackItem.round's
   * docstring for the round-numbering scheme. Undefined if no feedback had been delivered yet
   * (an agent reply posted before ever polling anything).
   */
  round?: number;
}

export const MAX_AGENT_REPLY_LENGTH = 10_000;

/** Validates an inbound agent-reply message: a non-empty, size-bounded string. */
export function isValidAgentReplyMessage(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_AGENT_REPLY_LENGTH;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function agentRepliesFile(hash: string, stateRoot: string): string {
  return path.join(sessionDirByHash(hash, stateRoot), "agent-replies.json");
}

/** Reads all agent replies recorded for a session, oldest first. Empty array if none yet. */
export async function readAgentReplies(
  hash: string,
  stateRoot: string = defaultStateRoot(),
): Promise<AgentReply[]> {
  const file = agentRepliesFile(hash, stateRoot);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return [];
    throw err;
  }
  return JSON.parse(raw) as AgentReply[];
}

/**
 * Appends one agent-reply message, atomically (write-to-temp-then-rename, same approach as
 * feedback-store's appendFeedback). Requires the session directory to already exist — callers
 * check this via readSessionRecordByHash before calling, same convention as appendFeedback.
 */
export async function appendAgentReply(
  hash: string,
  message: string,
  stateRoot: string = defaultStateRoot(),
): Promise<AgentReply> {
  const dir = sessionDirByHash(hash, stateRoot);
  await mkdir(dir, { recursive: true });
  const existing = await readAgentReplies(hash, stateRoot);

  const delivered = (await readFeedback(hash, stateRoot)).filter((item) => item.deliveredAt !== undefined);
  const round = delivered.reduce<number | undefined>(
    (max, item) => (item.round === undefined ? max : Math.max(max ?? 0, item.round)),
    undefined,
  );

  const reply: AgentReply = {
    id: randomUUID(),
    message: message.trim(),
    createdAt: new Date().toISOString(),
    ...(round === undefined ? {} : { round }),
  };
  const combined = [...existing, reply];

  const target = agentRepliesFile(hash, stateRoot);
  const tmp = path.join(dir, `.agent-replies.json.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(combined, null, 2), "utf8");
  await rename(tmp, target);
  return reply;
}
