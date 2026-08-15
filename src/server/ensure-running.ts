import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "./config.js";

interface HealthBody {
  status?: string;
  service?: string;
}

function linkableHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function checkHealth(config: ServerConfig, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: linkableHost(config.host),
        port: config.port,
        path: "/health",
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          try {
            const body = JSON.parse(raw) as HealthBody;
            resolve(res.statusCode === 200 && body.service === "inkloop");
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves how to re-invoke this CLI as a detached background server. Prefers the compiled
 * dist/cli/index.js entry (the shipped path); falls back to running the TypeScript source
 * through tsx for local development, where dist/ may not exist yet.
 */
function resolveServerInvocation(): { command: string; args: string[] } {
  const compiledEntry = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  if (existsSync(compiledEntry)) {
    return { command: process.execPath, args: [compiledEntry, "__server"] };
  }
  const sourceEntry = fileURLToPath(new URL("../cli/index.ts", import.meta.url));
  return { command: "npx", args: ["tsx", sourceEntry, "__server"] };
}

/**
 * Ensures an inkloop server is listening at the configured host/port, spawning one as a
 * detached background process if none is reachable yet. Idempotent — a second call while a
 * server is already up is just a health check, no new process is spawned.
 */
export async function ensureServerRunning(config: ServerConfig): Promise<void> {
  if (await checkHealth(config)) return;

  const { command, args } = resolveServerInvocation();
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await checkHealth(config)) return;
    await sleep(100);
  }
  throw new Error(
    `inkloop server did not become healthy at ${config.host}:${config.port} within 5s`,
  );
}
