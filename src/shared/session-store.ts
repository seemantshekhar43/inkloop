import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SessionStatus = "opened" | "agent-ended" | "user-ended";

export interface SessionRecord {
  /** Absolute path of the artifact this session reviews. */
  filePath: string;
  status: SessionStatus;
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

export class SessionNotFoundError extends Error {
  constructor(filePath: string) {
    super(`No session found for ${filePath}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionCorruptError extends Error {
  constructor(sessionFile: string, cause: unknown) {
    super(`Session file is corrupt and cannot be read: ${sessionFile}`, { cause });
    this.name = "SessionCorruptError";
  }
}

export type OpenSessionResult =
  | { outcome: "opened"; record: SessionRecord }
  | { outcome: "resumed"; record: SessionRecord }
  | { outcome: "refused"; reason: "user-ended-without-reopen"; record: SessionRecord };

/** Default root for all session state. Overridable so tests never touch the real home dir. */
export function defaultStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env["INKLOOP_STATE_DIR"]?.trim() || path.join(os.homedir(), ".inkloop");
}

/**
 * Derives a filesystem-safe, deterministic session key from an absolute artifact path. We hash
 * rather than use the raw path so session directories never contain path separators, spaces, or
 * characters invalid on a given filesystem, and so the same artifact path always maps to the
 * same session regardless of how it's later referenced.
 *
 * Takes an already-absolute path — callers resolve relative paths via resolveArtifactPath()
 * first, so hashing has no implicit dependency on the caller's cwd.
 */
export function hashArtifactPath(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex").slice(0, 16);
}

export function sessionDirByHash(hash: string, stateRoot: string = defaultStateRoot()): string {
  return path.join(stateRoot, hash);
}

export function sessionDir(absolutePath: string, stateRoot: string = defaultStateRoot()): string {
  return sessionDirByHash(hashArtifactPath(absolutePath), stateRoot);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Reads a session record directly by its hash, without knowing the artifact path in advance.
 * This is what lets the HTTP server serve `/session/<hash>/...` routes safely: the hash is an
 * opaque key chosen server-side when the session was created, never a client-supplied filesystem
 * path, so there is no path-traversal surface here even though it ultimately resolves to a file
 * read (see create-server.ts's artifact route).
 */
export async function readSessionRecordByHash(
  hash: string,
  stateRoot: string = defaultStateRoot(),
): Promise<SessionRecord | undefined> {
  const file = path.join(sessionDirByHash(hash, stateRoot), "session.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch (err) {
    throw new SessionCorruptError(file, err);
  }
}

/**
 * Reads the session record for an artifact path, or undefined if no session has ever been
 * opened for it. Throws SessionCorruptError rather than silently treating malformed state as
 * "no session" — a corrupt file masking as a fresh session could let a user-ended session be
 * silently reopened, which is a data-integrity concern worth failing loudly on.
 */
export async function readSessionRecord(
  absolutePath: string,
  stateRoot: string = defaultStateRoot(),
): Promise<SessionRecord | undefined> {
  return readSessionRecordByHash(hashArtifactPath(absolutePath), stateRoot);
}

/**
 * Writes the session record atomically: write to a temp file in the same directory, then
 * rename over the target. A crash or concurrent read mid-write can never observe a
 * partially-written session.json this way.
 */
async function writeSessionRecordAtomic(
  record: SessionRecord,
  stateRoot: string = defaultStateRoot(),
): Promise<void> {
  const dir = sessionDir(record.filePath, stateRoot);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, "session.json");
  const tmp = path.join(dir, `.session.json.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
  await rename(tmp, target);
}

/**
 * Opens a new session or resumes an existing one, matching lavish-axi's reopen semantics
 * documented in docs/plan.md: a session the user ended from the browser refuses to reopen
 * unless the caller explicitly passes reopen: true. Agent-ended and never-opened sessions
 * always resume/open freely.
 */
export async function openOrResumeSession(
  absolutePath: string,
  options: { reopen?: boolean; stateRoot?: string } = {},
): Promise<OpenSessionResult> {
  const stateRoot = options.stateRoot ?? defaultStateRoot();
  const existing = await readSessionRecord(absolutePath, stateRoot);
  const now = new Date().toISOString();

  if (!existing) {
    const record: SessionRecord = {
      filePath: absolutePath,
      status: "opened",
      createdAt: now,
      updatedAt: now,
    };
    await writeSessionRecordAtomic(record, stateRoot);
    return { outcome: "opened", record };
  }

  if (existing.status === "user-ended" && !options.reopen) {
    return { outcome: "refused", reason: "user-ended-without-reopen", record: existing };
  }

  const record: SessionRecord = { ...existing, status: "opened", updatedAt: now };
  await writeSessionRecordAtomic(record, stateRoot);
  return { outcome: "resumed", record };
}

/**
 * Ends a session. Throws SessionNotFoundError if no session was ever opened for this path —
 * ending a session that doesn't exist is a caller bug, not a state worth silently accepting.
 */
export async function endSession(
  absolutePath: string,
  endedBy: "agent" | "user",
  stateRoot: string = defaultStateRoot(),
): Promise<SessionRecord> {
  const existing = await readSessionRecord(absolutePath, stateRoot);
  if (!existing) throw new SessionNotFoundError(absolutePath);

  const record: SessionRecord = {
    ...existing,
    status: endedBy === "agent" ? "agent-ended" : "user-ended",
    updatedAt: new Date().toISOString(),
  };
  await writeSessionRecordAtomic(record, stateRoot);
  return record;
}

/** Removes all session state for an artifact path. Used by tests; not exposed via the CLI in v1. */
export async function deleteSession(
  absolutePath: string,
  stateRoot: string = defaultStateRoot(),
): Promise<void> {
  await rm(sessionDir(absolutePath, stateRoot), { recursive: true, force: true });
}
