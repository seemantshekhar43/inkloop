import { readFeedback } from "./feedback-store.js";
import { readAgentReplies } from "./agent-reply-store.js";
import type { AgentReply } from "./agent-reply-store.js";
import type { FeedbackItem } from "./feedback.js";
import { defaultStateRoot } from "./session-store.js";

/**
 * One round of the review conversation: the annotations sent together in a single "Send" click,
 * plus the agent's reply (if any) that responded to them. Feeds the round-history panel — see
 * review-shell.ts's history handle/panel for the client side.
 */
export interface HistoryRound {
  round: number;
  items: FeedbackItem[];
  reply?: AgentReply;
}

export interface SessionHistory {
  rounds: HistoryRound[];
  /** Total number of annotations across every round — the "M comments" half of the handle
   * bar's "N rounds, M comments" label. */
  commentCount: number;
}

/**
 * Groups a session's persisted feedback and agent replies into rounds, oldest first. Both
 * feedback.json (round assigned by appendFeedback) and agent-replies.json (round assigned by
 * appendAgentReply — see its docstring) already carry everything needed; this just joins them.
 *
 * An agent reply posted before any feedback was ever delivered has `round: undefined` (see
 * AgentReply's docstring) — treated as round 0 here, a bucket appendFeedback's numbering (which
 * starts at 1) never produces on its own, so it can't collide with a real round.
 */
export async function readSessionHistory(
  hash: string,
  stateRoot: string = defaultStateRoot(),
): Promise<SessionHistory> {
  const [feedback, replies] = await Promise.all([
    readFeedback(hash, stateRoot),
    readAgentReplies(hash, stateRoot),
  ]);

  const roundNumbers = new Set<number>();
  for (const item of feedback) if (item.round !== undefined) roundNumbers.add(item.round);
  for (const reply of replies) roundNumbers.add(reply.round ?? 0);

  const rounds: HistoryRound[] = [...roundNumbers]
    .sort((a, b) => a - b)
    .map((round) => {
      const reply = replies.find((reply) => (reply.round ?? 0) === round);
      return {
        round,
        items: feedback.filter((item) => item.round === round),
        ...(reply === undefined ? {} : { reply }),
      };
    });

  const commentCount = feedback.filter((item) => item.round !== undefined).length;
  return { rounds, commentCount };
}
