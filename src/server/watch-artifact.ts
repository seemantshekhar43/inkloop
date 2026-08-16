import { EventEmitter } from "node:events";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Coalesces rapid successive saves (e.g. an editor's atomic write plus a formatter re-save)
 * into a single reload instead of one per fs event. */
const CHANGE_DEBOUNCE_MS = 200;

const LOCAL_ASSET_ATTR_RE = /\b(?:src|href)\s*=\s*["']([^"'#][^"']*)["']/gi;

/**
 * Extracts local sibling-asset paths the artifact HTML declares via `src=`/`href=` — anything
 * that isn't an absolute URL (has a scheme, or is protocol-relative) and resolves to a real file
 * inside the artifact's own directory tree. Used to watch not just the artifact file itself but
 * whatever it visibly depends on, per issue #8's "declared sibling assets" requirement.
 *
 * Computed once at watcher setup from the artifact's content at that moment — a known v1
 * limitation is that an asset reference *added* to the artifact later won't be picked up until
 * the session is reopened (a fresh watcher is created). Re-deriving this on every change would
 * mean tearing down and rebuilding fs.watch handles on every save, which is more churn than the
 * benefit justifies for v1.
 */
export function extractLocalSiblingAssets(html: string, artifactPath: string): string[] {
  const artifactDir = path.dirname(artifactPath);
  const found = new Set<string>();
  for (const match of html.matchAll(LOCAL_ASSET_ATTR_RE)) {
    const raw = match[1];
    if (!raw) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // any URL scheme (http:, data:, mailto:, ...)
    if (raw.startsWith("//")) continue; // protocol-relative
    const withoutQuery = raw.split(/[?#]/)[0];
    if (!withoutQuery) continue;

    const resolved = path.resolve(artifactDir, withoutQuery);
    const relativeToDir = path.relative(artifactDir, resolved);
    // Must stay within the artifact's own directory tree — refuse to watch (or leak the
    // existence of) anything a `../` reference points outside it.
    if (relativeToDir.startsWith("..") || path.isAbsolute(relativeToDir)) continue;
    if (resolved === artifactPath) continue;
    if (existsSync(resolved)) found.add(resolved);
  }
  return [...found];
}

/**
 * Watches an artifact file and its declared local sibling assets for changes, exposing a
 * monotonically increasing `version` that live-reload long-poll requests wait on (see
 * create-server.ts's /session/:hash/reload route). One instance is created lazily per session
 * and lives for the server process's lifetime — see create-server.ts's watcher map and close().
 */
export class ArtifactWatcher extends EventEmitter {
  private version = 0;
  private readonly watchers: FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(artifactPath: string, siblingPaths: readonly string[]) {
    super();

    // Watches each target's parent directory rather than the file itself, filtering events by
    // basename. Watching a file path directly misses atomic saves that replace it via
    // rename-over — the common pattern editors, formatters, and build tools use for a "safe"
    // write (macOS's fs.watch in particular ties the watch to the original inode, so a rename
    // silently orphans it). A directory watch's rename events fire regardless of the inode
    // churn underneath, so live reload survives both plain in-place writes and atomic replaces.
    const targetsByDir = new Map<string, Set<string>>();
    for (const target of [artifactPath, ...siblingPaths]) {
      const dir = path.dirname(target);
      const basenames = targetsByDir.get(dir) ?? new Set<string>();
      basenames.add(path.basename(target));
      targetsByDir.set(dir, basenames);
    }

    for (const [dir, basenames] of targetsByDir) {
      try {
        this.watchers.push(
          watch(dir, (_eventType, filename) => {
            // A null filename (platform-dependent) means "something changed in here, exact
            // file unknown" — treat that as a match too rather than silently missing it; the
            // debounce below means an over-eager bump costs nothing but one extra reload.
            if (filename === null || basenames.has(filename)) this.scheduleBump();
          }),
        );
      } catch {
        // The directory may have been deleted between discovery and watch setup — skip it
        // rather than failing live reload for the whole session over one missing directory.
      }
    }
  }

  private scheduleBump(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.version += 1;
      this.emit("change", this.version);
    }, CHANGE_DEBOUNCE_MS);
  }

  getVersion(): number {
    return this.version;
  }

  close(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const w of this.watchers) w.close();
  }
}

/** Reads the artifact's current content to discover sibling assets, then constructs the watcher.
 * Falls back to watching just the artifact path (no siblings) if it can't be read right now —
 * fs.watch will still surface the artifact's own future changes either way. */
export async function createArtifactWatcher(artifactPath: string): Promise<ArtifactWatcher> {
  let html = "";
  try {
    html = await readFile(artifactPath, "utf8");
  } catch {
    // Missing at watcher-setup time; nothing to extract siblings from.
  }
  const siblings = html ? extractLocalSiblingAssets(html, artifactPath) : [];
  return new ArtifactWatcher(artifactPath, siblings);
}

/**
 * Resolves once the watcher's version exceeds `sinceVersion`, or after `timeoutMs` — whichever
 * comes first — returning the version observed at that point. Mirrors handlePollRoute's
 * long-poll shape in create-server.ts, but event-driven (via ArtifactWatcher's 'change' event)
 * rather than poll-a-file-on-an-interval, since here the "queue" being waited on is in-process
 * rather than something only visible by re-reading a file from disk.
 */
export function waitForChange(
  watcher: ArtifactWatcher,
  sinceVersion: number,
  timeoutMs: number,
): Promise<number> {
  if (watcher.getVersion() > sinceVersion) return Promise.resolve(watcher.getVersion());

  return new Promise((resolve) => {
    let settled = false;
    const onChange = (version: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watcher.off("change", onChange);
      resolve(version);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      watcher.off("change", onChange);
      resolve(watcher.getVersion());
    }, timeoutMs);
    watcher.on("change", onChange);
  });
}
