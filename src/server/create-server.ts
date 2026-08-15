import http from "node:http";
import { readFile } from "node:fs/promises";
import type { ServerConfig } from "./config.js";
import { isHostAllowed } from "./host-validation.js";
import { readSessionRecordByHash } from "../shared/session-store.js";
import { appendFeedback } from "../shared/feedback-store.js";
import { isValidFeedbackBatch } from "../shared/feedback.js";
import { renderReviewShell } from "./review-shell.js";
import { injectSdkScript, readSdkSource, SdkNotBuiltError } from "./inject-sdk.js";

export interface InkloopServer {
  server: http.Server;
  /** Resolves once the server is listening; value is the actual bound port. */
  listening: Promise<number>;
  /** Stops the idle timer and closes the server. */
  close(): Promise<void>;
}

const SESSION_ROUTE = /^\/session\/([0-9a-f]{16})(\/artifact)?\/?$/;
const FEEDBACK_ROUTE = /^\/session\/([0-9a-f]{16})\/feedback\/?$/;

/** Hard cap on a feedback POST body — an unauthenticated local server should never buffer an
 * unbounded request into memory, regardless of what shape validation would later reject it for. */
const MAX_FEEDBACK_BODY_BYTES = 2 * 1024 * 1024;

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

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok", service: "inkloop" });
    return;
  }

  if (req.method === "GET" && req.url === "/sdk.js") {
    await handleSdkRoute(res);
    return;
  }

  const feedbackMatch = req.url ? FEEDBACK_ROUTE.exec(req.url) : null;
  if (req.method === "POST" && feedbackMatch) {
    await handleFeedbackRoute(req, res, feedbackMatch[1] as string);
    return;
  }

  const match = req.url ? SESSION_ROUTE.exec(req.url) : null;
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
 * serve time), POST /session/:hash/feedback (queue a batch of drafted annotations). The long-poll
 * side that an agent process consumes lands in issue #7.
 */
export function createInkloopServer(
  config: ServerConfig,
  onIdleTimeout?: () => void,
): InkloopServer {
  let lastActivity = Date.now();

  const server = http.createServer((req, res) => {
    lastActivity = Date.now();

    const forwardedHost = req.headers["x-forwarded-host"];
    const hostToCheck =
      config.trustProxy && typeof forwardedHost === "string" ? forwardedHost : req.headers.host;

    if (!isHostAllowed(hostToCheck, config)) {
      sendJson(res, 403, { error: "invalid_host", message: "Host header not allowed" });
      return;
    }

    handleRequest(req, res).catch((err: unknown) => {
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
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return { server, listening, close };
}
