import http from "node:http";
import type { ServerConfig } from "./config.js";
import { isHostAllowed } from "./host-validation.js";

export interface InkloopServer {
  server: http.Server;
  /** Resolves once the server is listening; value is the actual bound port. */
  listening: Promise<number>;
  /** Stops the idle timer and closes the server. */
  close(): Promise<void>;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Creates the loopback-bound HTTP server. Every request is checked against the Host header
 * (and X-Forwarded-Host, when present, for the reverse-proxy case documented in docs/plan.md)
 * before any route handling runs — see host-validation.ts for the DNS-rebinding rationale.
 *
 * Only route so far is GET /health; session routes land in later issues (#3, #4).
 */
export function createInkloopServer(config: ServerConfig, onIdleTimeout?: () => void): InkloopServer {
  let lastActivity = Date.now();

  const server = http.createServer((req, res) => {
    lastActivity = Date.now();

    const forwardedHost = req.headers["x-forwarded-host"];
    const hostToCheck = typeof forwardedHost === "string" ? forwardedHost : req.headers.host;

    if (!isHostAllowed(hostToCheck, config)) {
      sendJson(res, 403, { error: "invalid_host", message: "Host header not allowed" });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
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
