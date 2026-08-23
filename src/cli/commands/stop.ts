import http from "node:http";
import { loadServerConfig } from "../../server/config.js";
import type { ServerConfig } from "../../server/config.js";

function linkableHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function requestJson(
  config: ServerConfig,
  method: "GET" | "POST",
  urlPath: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: linkableHost(config.host),
        port: config.port,
        path: urlPath,
        method,
        timeout: timeoutMs,
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
    req.end();
  });
}

/**
 * Implements `inkloop stop`: shuts down the shared background server
 * (the same one `ensure-running.ts` spawns detached on first `inkloop <file>`/`poll`/`end`), not
 * any single review session — a session stays ended-or-not per its own session.json regardless of
 * whether the server process is up. Deliberately does not call `ensureServerRunning`: spawning a
 * server just to immediately stop it would be pointless busywork, so this checks GET /health
 * directly and no-ops if nothing answers.
 */
export async function runStopCommand(): Promise<number> {
  const config = loadServerConfig();

  let health: { status: number; body: unknown };
  try {
    health = await requestJson(config, "GET", "/health", 1000);
  } catch {
    process.stdout.write("inkloop: no server running\n");
    return 0;
  }

  const healthy =
    health.status === 200 &&
    (health.body as { service?: string } | undefined)?.service === "inkloop";
  if (!healthy) {
    process.stdout.write("inkloop: no server running\n");
    return 0;
  }

  try {
    await requestJson(config, "POST", "/shutdown", 5000);
  } catch (err) {
    process.stderr.write(
      `inkloop: failed to stop server (${err instanceof Error ? err.message : String(err)})\n`,
    );
    return 1;
  }

  process.stdout.write("inkloop: server stopped\n");
  return 0;
}
