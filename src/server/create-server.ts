import http from "node:http";
import { readFile } from "node:fs/promises";
import type { ServerConfig } from "./config.js";
import { isHostAllowed } from "./host-validation.js";
import { readSessionRecordByHash } from "../shared/session-store.js";
import { renderReviewShell } from "./review-shell.js";

export interface InkloopServer {
  server: http.Server;
  /** Resolves once the server is listening; value is the actual bound port. */
  listening: Promise<number>;
  /** Stops the idle timer and closes the server. */
  close(): Promise<void>;
}

const SESSION_ROUTE = /^\/session\/([0-9a-f]{16})(\/artifact)?\/?$/;

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
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": contents.length,
  });
  res.end(contents);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok", service: "inkloop" });
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
 * Routes: GET /health, GET /session/:hash (review shell), GET /session/:hash/artifact (the
 * artifact file itself). Feedback/poll routes land in issue #7.
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
