import http from "node:http";
import { hashArtifactPath, readSessionRecord, POLL_FEEDBACK_NEXT_STEP } from "../../shared/session-store.js";
import type { FeedbackItem } from "../../shared/feedback.js";
import { resolveArtifactPath } from "../../shared/paths.js";
import { loadServerConfig } from "../../server/config.js";
import type { ServerConfig } from "../../server/config.js";
import { ensureServerRunning } from "../../server/ensure-running.js";
import { encodeToonObject, encodeToonTable, type ToonRow } from "../../shared/toon.js";

export interface PollCommandOptions {
  /** Message to post via POST /session/:hash/agent-reply before polling again. */
  agentReply?: string;
  cwd?: string;
}

function linkableHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function requestJson(
  config: ServerConfig,
  method: "GET" | "POST",
  urlPath: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: linkableHost(config.host),
        port: config.port,
        path: urlPath,
        method,
        timeout: timeoutMs,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined });
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`request to ${urlPath} timed out after ${timeoutMs}ms`));
    });
    req.end(payload);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Flattens one FeedbackItem into a fixed-column TOON row (issue #15). `target`'s sub-fields are
 * hoisted to top-level `target_*` columns rather than kept nested: TOON's tabular form only
 * applies to a column when every row's value there is a primitive, or every row's nested object
 * has the *same* keys (spec §9.3) — but `target`'s optional fields (selector, offsets, quote,
 * fingerprint) genuinely vary item to item, so nesting it would force list-form fallback and
 * lose the whole token-savings point of a table. Flattening with `null` standing in for "not set
 * on this item" keeps every column primitive and uniform instead. Field order here becomes the
 * TOON header's column order (encodeToonTable takes it from the first row's key order).
 */
function feedbackItemToToonRow(item: FeedbackItem): ToonRow {
  return {
    id: item.id,
    target_kind: item.target.kind,
    target_selector: item.target.selector ?? null,
    target_startOffset: item.target.startOffset ?? null,
    target_endOffset: item.target.endOffset ?? null,
    target_quote: item.target.quote ?? null,
    target_fingerprint: item.target.fingerprint ?? null,
    comment: item.comment,
    createdAt: item.createdAt,
    deliveredAt: item.deliveredAt ?? null,
    claimedAt: item.claimedAt ?? null,
    round: item.round ?? null,
    drifted: item.drifted ?? null,
    driftedAt: item.driftedAt ?? null,
  };
}

/**
 * Implements `inkloop poll <file>` (issue #7): the agent-facing half of the core loop. Blocks
 * until feedback is queued, re-issuing the bounded server-side long-poll request automatically
 * on each empty result so the caller's single invocation blocks indefinitely from its own
 * perspective. stdout carries only the final feedback payload (as JSON); every progress banner
 * goes to stderr, keeping stdout parseable as a single payload for the caller.
 *
 * The payload is always `{ items, next_step, ... }` (issue #39) rather than a bare items array:
 * `next_step` spells out the literal next command, and — when the session ended mid-wait, with or
 * without a final batch of items — `ended`/`endedBy` ride along too, sourced from the server's own
 * `next_step` for that case (see create-server.ts's handlePollRoute). Returning as soon as `ended`
 * is true, even with an empty `items`, also fixes what would otherwise be a busy-loop: the server
 * skips the rest of its timeout once a session ends, so without this check every immediate
 * empty-but-ended reply would just be re-polled forever.
 */
export async function runPollCommand(
  filePathArg: string,
  options: PollCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const absolutePath = resolveArtifactPath(filePathArg, cwd);

  const record = await readSessionRecord(absolutePath);
  if (!record) {
    process.stderr.write(
      `inkloop: no session found for ${absolutePath} — run \`inkloop ${filePathArg}\` first.\n`,
    );
    return 1;
  }

  const config = loadServerConfig();
  await ensureServerRunning(config);
  const hash = hashArtifactPath(absolutePath);

  if (options.agentReply !== undefined) {
    process.stderr.write("[inkloop] posting agent reply…\n");
    const { status } = await requestJson(
      config,
      "POST",
      `/session/${hash}/agent-reply`,
      { message: options.agentReply },
      5000,
    );
    if (status !== 201) {
      process.stderr.write(`inkloop: failed to post agent reply (server responded ${status})\n`);
      return 1;
    }
  }

  // Client-side request timeout is padded past the server's own bound so a slow-but-healthy
  // long-poll response is never cut off by this side first.
  const requestTimeoutMs = config.pollTimeoutMs + 5000;

  process.stderr.write("[inkloop] waiting for feedback…\n");
  for (;;) {
    let result: { status: number; body: unknown };
    try {
      result = await requestJson(config, "GET", `/session/${hash}/poll`, undefined, requestTimeoutMs);
    } catch (err) {
      process.stderr.write(
        `[inkloop] poll request failed (${err instanceof Error ? err.message : String(err)}), retrying…\n`,
      );
      await sleep(1000);
      continue;
    }

    if (result.status !== 200) {
      process.stderr.write(`inkloop: server responded ${result.status} to poll request\n`);
      return 1;
    }

    const body = result.body as
      | { items?: FeedbackItem[]; ended?: boolean; endedBy?: string; next_step?: string }
      | undefined;
    const items = body?.items ?? [];
    const ended = body?.ended === true;

    if (items.length > 0 || ended) {
      // TOON output (issue #15): the items table and the trailing scalar fields are two
      // independent fragments joined with a newline, matching how the reference TOON encoder
      // renders one root object with a tabular array property followed by keyed scalar
      // properties (see test/shared/toon.golden.test.ts for the byte-for-byte proof).
      const itemsBlock = encodeToonTable("items", items.map(feedbackItemToToonRow));
      const tailBlock = ended
        ? encodeToonObject({ ended: true, endedBy: body?.endedBy ?? null, next_step: body?.next_step ?? null })
        : encodeToonObject({ next_step: POLL_FEEDBACK_NEXT_STEP });
      process.stdout.write(`${itemsBlock}\n${tailBlock}\n`);
      return 0;
    }

    process.stderr.write("[inkloop] no feedback yet, still waiting…\n");
  }
}
