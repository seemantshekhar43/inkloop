#!/usr/bin/env node
import { getVersion } from "../shared/version.js";

const HELP_TEXT = `inkloop — local-first review loop for agent-written HTML artifacts

Usage:
  inkloop <file>            Open or resume a review session for <file>
  inkloop poll <file>       Long-poll for queued feedback
  inkloop end <file>        End a session (agent-initiated)
  inkloop --version         Print the installed version
  inkloop --help            Show this help text

Subcommands beyond version/help are not implemented yet — see
https://github.com/seemantshekhar43/inkloop/issues for the v1 backlog.
`;

export function run(argv: readonly string[]): number {
  const [first] = argv;

  if (first === "--version" || first === "-v") {
    process.stdout.write(`${getVersion()}\n`);
    return 0;
  }

  if (first === "--help" || first === "-h" || first === undefined) {
    process.stdout.write(HELP_TEXT);
    return first === undefined ? 1 : 0;
  }

  process.stderr.write(`inkloop: unrecognized command "${first}"\n\n${HELP_TEXT}`);
  return 1;
}

/* c8 ignore start -- exercised via the compiled CLI binary, not unit tests */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = run(process.argv.slice(2));
}
/* c8 ignore stop */
