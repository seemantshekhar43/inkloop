import http from "node:http";
import { readFile } from "node:fs/promises";
import type { ServerConfig } from "./config.js";
import { isHostAllowed } from "./host-validation.js";
import { endSession, nextStepGuidance, readSessionRecordByHash } from "../shared/session-store.js";
import {
  appendFeedback,
  markFeedbackDrifted,
  readPendingFeedback,
  takePendingFeedback,
} from "../shared/feedback-store.js";
import { isValidDriftIdBatch, isValidFeedbackBatch } from "../shared/feedback.js";
import { appendAgentReply, isValidAgentReplyMessage } from "../shared/agent-reply-store.js";
import { readSessionHistory } from "../shared/history.js";
import { renderReviewShell } from "./review-shell.js";
import { injectSdkScript, readSdkSource, SdkNotBuiltError } from "./inject-sdk.js";
import { ArtifactWatcher, createArtifactWatcher, waitForChange } from "./watch-artifact.js";
import { createTabPresenceTracker, type TabPresenceTracker } from "./tab-presence.js";

export interface InkloopServer {
  server: http.Server;
  /** Resolves once the server is listening; value is the actual bound port. */
  listening: Promise<number>;
  /** Stops the idle timer and closes the server. */
  close(): Promise<void>;
}

const SESSION_ROUTE = /^\/session\/([0-9a-f]{16})(\/artifact)?\/?$/;
const FEEDBACK_ROUTE = /^\/session\/([0-9a-f]{16})\/feedback\/?$/;
const POLL_ROUTE = /^\/session\/([0-9a-f]{16})\/poll\/?$/;
const AGENT_REPLY_ROUTE = /^\/session\/([0-9a-f]{16})\/agent-reply\/?$/;
const HISTORY_ROUTE = /^\/session\/([0-9a-f]{16})\/history\/?$/;
const DRIFT_ROUTE = /^\/session\/([0-9a-f]{16})\/drift\/?$/;
const RELOAD_ROUTE = /^\/session\/([0-9a-f]{16})\/reload\/?$/;
const TAB_LEAVE_ROUTE = /^\/session\/([0-9a-f]{16})\/tab-leave\/?$/;
const END_ROUTE = /^\/session\/([0-9a-f]{16})\/end\/?$/;

/** How often the poll route re-checks for newly-queued feedback while it waits. */
const POLL_CHECK_INTERVAL_MS = 300;

/** Hard cap on an agent-reply POST body, same rationale as MAX_FEEDBACK_BODY_BYTES below. */
const MAX_AGENT_REPLY_BODY_BYTES = 64 * 1024;

/** Hard cap on a drift-report POST body (issue #10) — just a batch of ids, so this stays small. */
const MAX_DRIFT_BODY_BYTES = 64 * 1024;

/** Hard cap on a feedback POST body — an unauthenticated local server should never buffer an
 * unbounded request into memory, regardless of what shape validation would later reject it for. */
const MAX_FEEDBACK_BODY_BYTES = 2 * 1024 * 1024;

/** Hard cap on a tab-leave beacon body (issue #65) — just a tab id, so this stays tiny. */
const MAX_TAB_LEAVE_BODY_BYTES = 4 * 1024;

/**
 * Buffers a request body up to a byte cap, returning undefined if it was exceeded. Stops
 * accumulating chunks once over the cap (so memory use stays bounded) but still lets the stream
 * drain to "end" rather than destroying the socket — destroying mid-request would tear down the
 * connection before a 413 response could be written back on it.
 */
function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

async function handleSessionRoute(
  res: http.ServerResponse,
  hash: string,
  wantsArtifact: boolean,
): Promise<void> {
  // The hash is an opaque, server-chosen key (see readSessionRecordByHash's docstring) — there
  // is no client-supplied filesystem path here, so this lookup carries no path-traversal risk
  // even though it ultimately leads to a file read below.
  const record = await readSessionRecordByHash(hash);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  if (!wantsArtifact) {
    sendHtml(res, 200, renderReviewShell(hash));
    return;
  }

  let contents: Buffer;
  try {
    contents = await readFile(record.filePath);
  } catch {
    sendJson(res, 404, {
      error: "artifact_not_found",
      message: "The artifact file no longer exists on disk",
    });
    return;
  }
  // Injected at serve time only — never written back to the file on disk. See inject-sdk.ts.
  sendHtml(res, 200, injectSdkScript(contents.toString("utf8")));
}

async function handleSdkRoute(res: http.ServerResponse): Promise<void> {
  let source: string;
  try {
    source = await readSdkSource();
  } catch (err) {
    if (err instanceof SdkNotBuiltError) {
      sendJson(res, 500, { error: "sdk_not_built", message: err.message });
      return;
    }
    throw err;
  }
  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Content-Length": Buffer.byteLength(source),
  });
  res.end(source);
}

async function handleFeedbackRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  hash: string,
): Promise<void> {
  // Same opaque-hash reasoning as handleSessionRoute — no client-supplied path here.
  const record = await readSessionRecordByHash(hash);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  const raw = await readBody(req, MAX_FEEDBACK_BODY_BYTES);
  if (raw === undefined) {
    sendJson(res, 413, { error: "payload_too_large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  if (!isValidFeedbackBatch(parsed)) {
    sendJson(res, 400, { error: "invalid_feedback_batch" });
    return;
  }

  const combined = await appendFeedback(hash, parsed);
  sendJson(res, 201, { queued: parsed.length, total: combined.length });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The long-poll side of the core loop (issue #7): blocks up to config.pollTimeoutMs, checking
 * for newly-queued feedback every POLL_CHECK_INTERVAL_MS, and returns as soon as any exists.
 * Returns an empty `items` array (still 200, not an error) on timeout — the CLI treats an empty
 * result as "nothing yet" and re-issues the request, so from the agent's perspective a single
 * `inkloop poll` call blocks indefinitely across as many of these bounded requests as it takes.
 *
 * Claims (marks delivered) whatever it returns via takePendingFeedback, so a subsequent poll
 * never redelivers the same items — see that function's docstring for the persistence model.
 *
 * Also watches the session's own status on every loop iteration (issue #9): if the session ends
 * — whether it was already ended before this call started, or ends mid-wait (e.g. the user
 * clicks "End session" in the browser while an agent is still polling) — this returns
 * immediately rather than waiting out the rest of the timeout, delivering whatever feedback was
 * still pending as the *final* batch alongside `ended`/`endedBy`/`next_step`. That's the "final
 * feedback batch... carries next_step guidance" half of the issue; the other half is the
 * no-pending-feedback case, which reaches the same `ended` shape with an empty `items` array.
 */
async function handlePollRoute(
  res: http.ServerResponse,
  hash: string,
  pollTimeoutMs: number,
): Promise<void> {
  let record = await readSessionRecordByHash(hash);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    const pending = await readPendingFeedback(hash);
    record = await readSessionRecordByHash(hash);
    const guidance = record ? nextStepGuidance(record.status) : undefined;
    const ended = guidance !== undefined;

    if (pending.length > 0 || ended) {
      const claimed = pending.length > 0 ? await takePendingFeedback(hash) : [];
      const body: Record<string, unknown> = { items: claimed };
      if (ended && record) {
        body["ended"] = true;
        body["endedBy"] = record.status === "user-ended" ? "user" : "agent";
        body["next_step"] = guidance;
      }
      sendJson(res, 200, body);
      return;
    }
    if (Date.now() >= deadline) {
      sendJson(res, 200, { items: [] });
      return;
    }
    await sleep(Math.min(POLL_CHECK_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }
}

async function handleAgentReplyRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  hash: string,
): Promise<void> {
  const record = await readSessionRecordByHash(hash);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  const raw = await readBody(req, MAX_AGENT_REPLY_BODY_BYTES);
  if (raw === undefined) {
    sendJson(res, 413, { error: "payload_too_large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const message = (parsed as Record<string, unknown> | null)?.["message"];
  if (!isValidAgentReplyMessage(message)) {
    sendJson(res, 400, { error: "invalid_agent_reply" });
    return;
  }

  const reply = await appendAgentReply(hash, message);
  sendJson(res, 201, { reply });
}

/**
 * The SDK's drift check (issue #10) posts here after recomputing text-range fingerprints against
 * the live artifact on every load/reload — see sdk/index.ts's checkDrift. Idempotent per id (see
 * markFeedbackDrifted), so the SDK can freely re-report the same drifted id on a later reload
 * without needing to track what it already reported.
 */
async function handleDriftRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  hash: string,
): Promise<void> {
  const record = await readSessionRecordByHash(hash);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  const raw = await readBody(req, MAX_DRIFT_BODY_BYTES);
  if (raw === undefined) {
    sendJson(res, 413, { error: "payload_too_large" });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const ids = (parsed as Record<string, unknown> | null)?.["ids"];
  if (!isValidDriftIdBatch(ids)) {
    sendJson(res, 400, { error: "invalid_drift_batch" });
    return;
  }

  const drifted = await markFeedbackDrifted(hash, ids);
  sendJson(res, 200, { drifted: drifted.length });
}

/**
 * The review shell's round-history panel (issue #21) fetches this on load and refreshes it
 * alongside the reload long-poll's own tick — see review-shell.ts's fetchHistory. Just a plain
 * GET, not a long-poll: history changes at the same low cadence as a "Send" click or an
 * `--agent-reply`, so there's no need for the bounded-wait machinery handlePollRoute and
 * handleReloadRoute use.
 */
async function handleHistoryRoute(res: http.ServerResponse, hash: string): Promise<void> {
  const record = await readSessionRecordByHash(hash);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  const history = await readSessionHistory(hash);
  sendJson(res, 200, history);
}

/**
 * Live reload's long-poll route (issue #8): mirrors handlePollRoute's shape (bounded wait,
 * returns promptly on a real event or an empty-ish result on timeout) but waits on an in-process
 * ArtifactWatcher rather than re-reading a file. `since` is the browser's last-known version;
 * responds immediately if the watcher has already moved past it, otherwise waits up to
 * pollTimeoutMs via watch-artifact.ts's waitForChange. The browser re-issues on every response
 * (whether or not the version advanced) with `since` set to whatever version it just saw, the
 * same re-issue-on-empty-result pattern `inkloop poll` uses.
 *
 * A watcher is created lazily on first request for a session hash and kept for the server
 * process's lifetime (see the `watchers` map in createInkloopServer and its close()).
 *
 * Also doubles as the per-tab presence heartbeat behind the "open in another tab" banner (issue
 * #40): when the request carries a `tab` id, it's recorded via `tabs` and the response says
 * whether some other tab has been seen recently — see tab-presence.ts for the tracking rules.
 * `tabId` is undefined for any client that predates this query param, in which case presence
 * tracking is simply skipped for that request (no banner, same as before this issue).
 */
async function handleReloadRoute(
  res: http.ServerResponse,
  hash: string,
  since: number,
  pollTimeoutMs: number,
  watchers: Map<string, ArtifactWatcher>,
  tabs: TabPresenceTracker,
  tabId: string | undefined,
): Promise<void> {
  const record = await readSessionRecordByHash(hash);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  let watcher = watchers.get(hash);
  if (!watcher) {
    watcher = await createArtifactWatcher(record.filePath);
    watchers.set(hash, watcher);
  }

  const version = await waitForChange(watcher, since, pollTimeoutMs);
  const otherTabActive = tabId !== undefined ? tabs.record(hash, tabId) : false;
  sendJson(res, 200, { version, otherTabActive });
}

/**
 * Issue #65: the review shell sends a `navigator.sendBeacon` here on `pagehide` (tab closed,
 * navigated away, or reloaded) so this tab's presence clears immediately instead of lingering
 * until it ages out of the reload-poll heartbeat (up to `staleAfterMs`, currently 3x the poll
 * timeout) — during that window, whatever tab a reviewer opens next could see a stale "open in
 * another tab" banner for a tab that's already gone. A beacon is fire-and-forget by design (the
 * page is unloading, nothing can react to a response), so this always returns 204 regardless of
 * whether hash/tabId turned out to be valid — same best-effort spirit as the beacon call site.
 */
async function handleTabLeaveRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  hash: string,
  tabs: TabPresenceTracker,
): Promise<void> {
  const raw = await readBody(req, MAX_TAB_LEAVE_BODY_BYTES);
  if (raw !== undefined) {
    try {
      const body = JSON.parse(raw) as { tabId?: unknown };
      if (typeof body.tabId === "string" && body.tabId.length > 0) {
        tabs.release(hash, body.tabId);
      }
    } catch {
      // Malformed beacon body — nothing to release, fall through to the same 204 either way.
    }
  }
  res.writeHead(204);
  res.end();
}

/**
 * User-initiated end (issue #9): the browser's "End session" button posts here. Ends the
 * session with status "user-ended", the terminal state `openOrResumeSession` refuses to reopen
 * without `--reopen` — see session-store.ts's docstring for the full reopen semantics. A poll
 * already in flight for this session picks up the change on its very next loop iteration (see
 * handlePollRoute above) rather than needing any direct signal from this route.
 */
async function handleEndRoute(res: http.ServerResponse, hash: string): Promise<void> {
  const record = await readSessionRecordByHash(hash);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  const updated = await endSession(record.filePath, "user");
  sendJson(res, 200, {
    status: "ended",
    endedBy: "user",
    next_step: nextStepGuidance(updated.status),
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ServerConfig,
  watchers: Map<string, ArtifactWatcher>,
  tabs: TabPresenceTracker,
): Promise<void> {
  // Parsed once so every route below matches on the path alone — query strings (the reload
  // route's ?since=, and the review shell's cache-busting ?v= on the artifact route after a
  // reload) never have to be stripped ad hoc per route.
  const url = new URL(req.url ?? "/", "http://internal");
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "inkloop" });
    return;
  }

  if (req.method === "GET" && pathname === "/sdk.js") {
    await handleSdkRoute(res);
    return;
  }

  const feedbackMatch = FEEDBACK_ROUTE.exec(pathname);
  if (req.method === "POST" && feedbackMatch) {
    await handleFeedbackRoute(req, res, feedbackMatch[1] as string);
    return;
  }

  const pollMatch = POLL_ROUTE.exec(pathname);
  if (req.method === "GET" && pollMatch) {
    await handlePollRoute(res, pollMatch[1] as string, config.pollTimeoutMs);
    return;
  }

  const agentReplyMatch = AGENT_REPLY_ROUTE.exec(pathname);
  if (req.method === "POST" && agentReplyMatch) {
    await handleAgentReplyRoute(req, res, agentReplyMatch[1] as string);
    return;
  }

  const historyMatch = HISTORY_ROUTE.exec(pathname);
  if (req.method === "GET" && historyMatch) {
    await handleHistoryRoute(res, historyMatch[1] as string);
    return;
  }

  const driftMatch = DRIFT_ROUTE.exec(pathname);
  if (req.method === "POST" && driftMatch) {
    await handleDriftRoute(req, res, driftMatch[1] as string);
    return;
  }

  const reloadMatch = RELOAD_ROUTE.exec(pathname);
  if (req.method === "GET" && reloadMatch) {
    const sinceParam = Number.parseInt(url.searchParams.get("since") ?? "0", 10);
    const since = Number.isFinite(sinceParam) && sinceParam >= 0 ? sinceParam : 0;
    const tabId = url.searchParams.get("tab") ?? undefined;
    await handleReloadRoute(
      res,
      reloadMatch[1] as string,
      since,
      config.pollTimeoutMs,
      watchers,
      tabs,
      tabId,
    );
    return;
  }

  const tabLeaveMatch = TAB_LEAVE_ROUTE.exec(pathname);
  if (req.method === "POST" && tabLeaveMatch) {
    await handleTabLeaveRoute(req, res, tabLeaveMatch[1] as string, tabs);
    return;
  }

  const endMatch = END_ROUTE.exec(pathname);
  if (req.method === "POST" && endMatch) {
    await handleEndRoute(res, endMatch[1] as string);
    return;
  }

  const match = SESSION_ROUTE.exec(pathname);
  if (req.method === "GET" && match) {
    const [, hash, artifactSuffix] = match;
    await handleSessionRoute(res, hash as string, Boolean(artifactSuffix));
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

/**
 * Creates the loopback-bound HTTP server. Every request is checked against the Host header
 * (and X-Forwarded-Host, only when config.trustProxy is explicitly true, for deployments behind
 * a trusted reverse proxy) before any route handling runs — see host-validation.ts for the
 * DNS-rebinding rationale. X-Forwarded-Host is not trusted by default: unlike Host, it is not a
 * forbidden header for fetch/XHR, so any page's JS could set it and defeat the DNS-rebinding
 * defense if it were trusted unconditionally.
 *
 * Routes: GET /health, GET /sdk.js (the injected browser SDK bundle), GET /session/:hash (review
 * shell), GET /session/:hash/artifact (the artifact file, with the SDK <script> injected at
 * serve time), POST /session/:hash/feedback (queue a batch of drafted annotations),
 * GET /session/:hash/poll (long-poll for queued feedback, consumed by `inkloop poll`),
 * POST /session/:hash/agent-reply (record an agent's revision summary ahead of its next poll),
 * GET /session/:hash/history (rounds of sent annotations paired with agent replies, for the
 * review shell's round-history panel), POST /session/:hash/drift (the SDK reports text-range
 * targets whose live content fingerprint no longer matches what was captured at queue time),
 * GET /session/:hash/reload (browser-side live-reload long-poll, watches the artifact and its
 * declared sibling assets for changes, and doubles as the issue #40 tab-presence heartbeat when
 * called with ?tab=), POST /session/:hash/end (user-initiated session end, the browser's
 * "End session" button).
 */
export function createInkloopServer(
  config: ServerConfig,
  onIdleTimeout?: () => void,
): InkloopServer {
  let lastActivity = Date.now();
  const watchers = new Map<string, ArtifactWatcher>();
  // A tab not seen for a few full reload-poll round-trips is treated as gone (closed,
  // backgrounded past any browser throttling, or a dead connection) rather than a live second
  // tab — see tab-presence.ts's docstring for why the reload long-poll doubles as this heartbeat.
  // The 3x multiplier leaves headroom past the bare minimum of "one round-trip per tab" so a
  // slow tick (event-loop or network jitter) doesn't flap the banner on and off.
  const tabs = createTabPresenceTracker(config.pollTimeoutMs * 3);

  const server = http.createServer((req, res) => {
    lastActivity = Date.now();

    const forwardedHost = req.headers["x-forwarded-host"];
    const hostToCheck =
      config.trustProxy && typeof forwardedHost === "string" ? forwardedHost : req.headers.host;

    if (!isHostAllowed(hostToCheck, config)) {
      sendJson(res, 403, { error: "invalid_host", message: "Host header not allowed" });
      return;
    }

    handleRequest(req, res, config, watchers, tabs).catch((err: unknown) => {
      process.stderr.write(
        `[inkloop] request handler error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
    });
  });

  let idleTimer: NodeJS.Timeout | undefined;
  if (config.idleTimeoutMs > 0) {
    const checkIntervalMs = Math.min(config.idleTimeoutMs, 60_000);
    idleTimer = setInterval(() => {
      if (Date.now() - lastActivity >= config.idleTimeoutMs) {
        onIdleTimeout?.();
        void close();
      }
    }, checkIntervalMs);
    idleTimer.unref();
  }

  const listening = new Promise<number>((resolve) => {
    server.listen(config.port, config.host, () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : config.port);
    });
  });

  function close(): Promise<void> {
    if (idleTimer) clearInterval(idleTimer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return { server, listening, close };
}
