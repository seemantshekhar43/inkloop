import { endSession, nextStepGuidance, SessionNotFoundError } from "../../shared/session-store.js";
import { resolveArtifactPath } from "../../shared/paths.js";
import { encodeToonObject } from "../../shared/toon.js";

export interface EndCommandOptions {
  cwd?: string;
}

/**
 * Implements `inkloop end <file>` (issue #9): agent-initiated session end. Ends with status
 * "agent-ended" — the one lifecycle state a later plain `inkloop <file>` may reopen freely
 * without `--reopen` (see session-store.ts's openOrResumeSession for the contrast with a
 * user-ended session). Prints a small TOON payload to stdout (issue #15), mirroring `inkloop
 * poll`'s stdout-is-structured-output convention, so an agent parsing the result gets the same
 * next_step guidance the poll route's "ended" response carries.
 */
export async function runEndCommand(
  filePathArg: string,
  options: EndCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const absolutePath = resolveArtifactPath(filePathArg, cwd);

  let record;
  try {
    record = await endSession(absolutePath, "agent");
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      process.stderr.write(
        `inkloop: no session found for ${absolutePath} — run \`inkloop ${filePathArg}\` first.\n`,
      );
      return 1;
    }
    throw err;
  }

  // Report the record's real status, not the fact that this CLI call was agent-initiated:
  // endSession() never downgrades an already user-ended session (see its own no-downgrade
  // guard), so endedBy must agree with next_step, which is sourced from record.status too.
  const endedBy = record.status === "user-ended" ? "user" : "agent";

  process.stdout.write(
    `${encodeToonObject({ status: "ended", endedBy, next_step: nextStepGuidance(record.status) ?? null })}\n`,
  );
  return 0;
}
