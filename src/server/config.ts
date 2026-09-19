/**
 * Server configuration, sourced from environment variables so both the CLI and tests can
 * construct it explicitly without depending on process.env directly inside server logic.
 */
export interface ServerConfig {
  /** Address to bind. Defaults to loopback-only. */
  host: string;
  /** Port to bind. 0 lets the OS assign an ephemeral port (used in tests). */
  port: number;
  /**
   * Host header values (hostname, no port) accepted in addition to the loopback names and the
   * configured bind address. `"*"` disables validation entirely and must only be set when the
   * server sits behind a trusted proxy/auth layer of its own.
   */
  allowedHosts: string[] | "*";
  /** Milliseconds of inactivity before the server self-stops. 0 disables the timeout. */
  idleTimeoutMs: number;
  /**
   * When true, X-Forwarded-Host is consulted (in addition to Host) for host validation, for
   * deployments that sit behind a trusted reverse proxy. Defaults to false: a page's JS cannot
   * override the real Host header but can freely set X-Forwarded-Host, so trusting it without an
   * explicit opt-in would defeat the DNS-rebinding defense in host-validation.ts.
   */
  trustProxy: boolean;
  /** Milliseconds a single GET /session/:hash/poll request blocks for before returning an empty
   * result. The CLI's `inkloop poll` re-issues automatically on an empty result, so this bounds
   * how long any one HTTP request stays open rather than how long the agent actually waits. */
  pollTimeoutMs: number;
}

const DEFAULT_PORT = 4879;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_TIMEOUT_MS = 30 * 1000;
const LOOPBACK_BIND_ADDRESSES = new Set(["127.0.0.1", "::1", "localhost"]);
const WILDCARD_BIND_ADDRESSES = new Set(["0.0.0.0", "::", "0000:0000:0000:0000:0000:0000:0000:0000"]);

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid port "${value}": must be an integer between 0 and 65535`);
  }
  return parsed;
}

function parseIdleTimeout(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  if (value === "0" || value.toLowerCase() === "off") return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid idle timeout "${value}": must be a non-negative integer or "off"`);
  }
  return parsed;
}

function parsePollTimeout(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid poll timeout "${value}": must be a positive integer`);
  }
  return parsed;
}

function parseAllowedHosts(value: string | undefined): string[] | "*" {
  if (!value) return [];
  if (value.trim() === "*") return "*";
  return value
    .split(/\s+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Reads server config from environment variables. Warns to stderr (does not throw) when the
 * bind host is a wildcard address: binding beyond loopback exposes an unauthenticated server
 * that can read and serve local files to anything that can reach it.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env["INKLOOP_HOST"]?.trim() || "127.0.0.1";
  if (WILDCARD_BIND_ADDRESSES.has(host)) {
    process.stderr.write(
      `[inkloop] warning: binding to ${host} exposes an unauthenticated server that can read and ` +
        `serve local files to anything that can reach it. Only do this on a trusted network.\n`,
    );
  }

  return {
    host,
    port: parsePort(env["INKLOOP_PORT"], DEFAULT_PORT),
    allowedHosts: parseAllowedHosts(env["INKLOOP_ALLOWED_HOSTS"]),
    idleTimeoutMs: parseIdleTimeout(env["INKLOOP_IDLE_TIMEOUT_MS"], DEFAULT_IDLE_TIMEOUT_MS),
    trustProxy: env["INKLOOP_TRUST_PROXY"]?.trim().toLowerCase() === "true",
    pollTimeoutMs: parsePollTimeout(env["INKLOOP_POLL_TIMEOUT_MS"], DEFAULT_POLL_TIMEOUT_MS),
  };
}

export { LOOPBACK_BIND_ADDRESSES };
