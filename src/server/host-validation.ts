import type { ServerConfig } from "./config.js";
import { LOOPBACK_BIND_ADDRESSES } from "./config.js";

/**
 * Strips a port suffix from a Host header value, handling bracketed IPv6 literals
 * (e.g. "[::1]:4879") as well as plain "hostname:port".
 */
function stripPort(hostHeaderValue: string): string {
  const trimmed = hostHeaderValue.trim();
  if (trimmed.startsWith("[")) {
    // Bracketed IPv6 literal, e.g. "[::1]:4879" or bare "[::1]" — return the address without
    // the brackets so it compares equal to the plain "::1" form used elsewhere (bind address,
    // loopback set, allow list).
    const closingBracket = trimmed.indexOf("]");
    return closingBracket === -1 ? trimmed : trimmed.slice(1, closingBracket);
  }
  const lastColon = trimmed.lastIndexOf(":");
  // A bare IPv6 literal without brackets has multiple colons; only strip a port when there's
  // exactly one colon, which is the unambiguous "hostname:port" / "ipv4:port" shape.
  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (lastColon === -1 || colonCount !== 1) return trimmed;
  return trimmed.slice(0, lastColon);
}

/**
 * Validates a Host (or X-Forwarded-Host) header value against the loopback names, the
 * configured bind address, and any explicitly configured allowed hosts. This is the
 * DNS-rebinding defense: without it, a malicious page in another tab could send requests that
 * the browser stamps with an attacker-controlled Host header pointing at this loopback server.
 *
 * Returns false for a missing/empty header — callers must reject those, not treat them as
 * implicitly allowed.
 */
export function isHostAllowed(
  hostHeaderValue: string | undefined,
  config: Pick<ServerConfig, "host" | "allowedHosts">,
): boolean {
  if (!hostHeaderValue || hostHeaderValue.trim() === "") return false;
  if (config.allowedHosts === "*") return true;

  const hostname = stripPort(hostHeaderValue).toLowerCase();
  if (LOOPBACK_BIND_ADDRESSES.has(hostname)) return true;
  if (hostname === config.host.toLowerCase()) return true;
  return config.allowedHosts.includes(hostname);
}
