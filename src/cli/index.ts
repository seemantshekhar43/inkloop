#!/usr/bin/env node
import { getVersion } from "../shared/version.js";
import { runOpenCommand } from "./commands/open.js";
import { runServerCommand } from "./commands/server.js";

const HELP_TEXT = `inkloop — local-first review loop for agent-written HTML artifacts

Usage:
  inkloop <file>            Open or resume a review session for <file>
  inkloop <file> --reopen   Reopen a session the user ended from the browser
  inkloop poll <file>       Long-poll for queued feedback
  inkloop end <file>        End a session (agent-initiated)
  inkloop --version         Print the installed version
  inkloop --help            Show this help text

poll and end are not implemented yet — see
https://github.com/seemantshekhar43/inkloop/issues/7 and /9.
`;

const NOT_YET_IMPLEMENTED: Record<string, string> = {
  poll: "https://github.com/seemantshekhar43/inkloop/issues/7",
  end: "https://github.com/seemantshekhar43/inkloop/issues/9",
};

export async function run(argv: readonly string[]): Promise<number> {
  const [first, ...rest] = argv;

  if (first === "--version" || first === "-v") {
    process.stdout.write(`${getVersion()}\n`);
    return 0;
  }

  if (first === "--help" || first === "-h" || first === undefined) {
    process.stdout.write(HELP_TEXT);
    return first === undefined ? 1 : 0;
  }

  // Internal: spawned by ensure-running.ts as a detached background process. Not documented in
  // --help; not meant to be run directly.
  if (first === "__server") {
    await runServerCommand();
    return 0; // unreachable — runServerCommand() never resolves
  }

  const notYetImplementedUrl = NOT_YET_IMPLEMENTED[first];
  if (notYetImplementedUrl) {
    process.stderr.write(`inkloop: "${first}" is not implemented yet — tracked at ${notYetImplementedUrl}\n`);
    return 1;
  }

  if (first.startsWith("-")) {
    process.stderr.write(`inkloop: unrecognized flag "${first}"\n\n${HELP_TEXT}`);
    return 1;
  }

  // Anything else is treated as the file argument to `inkloop <file>`.
  const reopen = rest.includes("--reopen");
  return runOpenCommand(first, { reopen });
}

/* c8 ignore start -- exercised via the compiled CLI binary, not unit tests */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`inkloop: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
