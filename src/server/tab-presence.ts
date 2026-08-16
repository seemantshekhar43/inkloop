/**
 * Tracks which browser tabs are actively polling a given session, so the review shell can show a
 * "this session may be open in another tab" banner (issue #40) without any lock/take-over
 * mechanic — the fix direction there is explicitly a visible signal, not enforced ownership.
 *
 * Piggybacks on the reload long-poll (issue #8): review-shell.ts already re-issues that request
 * continuously for as long as a tab is open, so it doubles as a per-tab heartbeat with no new
 * request loop needed. Each tab generates a random id once (sessionStorage-backed, so it survives
 * the shell's own live-reload-driven iframe swaps but not a full page reload) and sends it as a
 * query param on every reload request.
 *
 * State is in-memory only, scoped to one server process's lifetime — the same tradeoff watchers
 * (watch-artifact.ts) already makes for this single-process, loopback-only server.
 */
export interface TabPresenceTracker {
  /**
   * Records that `tabId` is alive for `hash` right now, prunes any tab not seen within
   * `staleAfterMs`, and returns whether some *other* tab has been seen recently. Called on every
   * reload poll, so "recently" always means "within the last one or two poll round-trips" —
   * see createTabPresenceTracker's staleAfterMs contract.
   */
  record(hash: string, tabId: string, now?: number): boolean;
}

export function createTabPresenceTracker(staleAfterMs: number): TabPresenceTracker {
  const byHash = new Map<string, Map<string, number>>();

  return {
    record(hash, tabId, now = Date.now()) {
      let tabs = byHash.get(hash);
      if (!tabs) {
        tabs = new Map();
        byHash.set(hash, tabs);
      }
      tabs.set(tabId, now);

      for (const [id, lastSeen] of tabs) {
        if (now - lastSeen > staleAfterMs) tabs.delete(id);
      }
      if (tabs.size === 0) byHash.delete(hash);

      for (const id of tabs.keys()) {
        if (id !== tabId) return true;
      }
      return false;
    },
  };
}
