#!/usr/bin/env node
import { getVersion } from "../shared/version.js";
import { runOpenCommand } from "./commands/open.js";
import { runPollCommand } from "./commands/poll.js";
import { runEndCommand } from "./commands/end.js";
import { runServerCommand } from "./commands/server.js";
import { runStopCommand } from "./commands/stop.js";
import { runStencilCommand } from "./commands/stencil.js";

const HELP_TEXT = `inkloop — local-first review loop for agent-written HTML artifacts

Usage:
  inkloop <file>                          Open or resume a review session for <file>
  inkloop <file> --reopen                 Reopen a session the user ended from the browser
  inkloop poll <file>                     Long-poll for queued feedback
  inkloop poll <file> --agent-reply <msg> Post a revision summary, then long-poll again
  inkloop end <file>                      End a session (agent-initiated)
  inkloop stop                            Stop the background server
  inkloop stencil                         List available content-guidance stencils
  inkloop stencil <id>                    Show authoring guidance for one stencil
  inkloop --version                       Print the installed version
  inkloop help                            Show this help text
  inkloop --help                          Show this help text
`;

export async function run(argv: readonly string[]): Promise<number> {
  const [first, ...rest] = argv;

  if (first === "--version" || first === "-v") {
    process.stdout.write(`${getVersion()}\n`);
    return 0;
  }

  if (first === "help" || first === "--help" || first === "-h" || first === undefined) {
    process.stdout.write(HELP_TEXT);
    return first === undefined ? 1 : 0;
  }

  // Internal: spawned by ensure-running.ts as a detached background process. Not documented in
  // --help; not meant to be run directly.
  if (first === "__server") {
    await runServerCommand();
    return 0; // unreachable — runServerCommand() never resolves
  }

  if (first === "poll") {
    const [pollFile, ...pollRest] = rest;
    if (!pollFile) {
      process.stderr.write("inkloop: `poll` requires a file argument\n\n" + HELP_TEXT);
      return 1;
    }
    const flagIndex = pollRest.indexOf("--agent-reply");
    if (flagIndex !== -1 && pollRest[flagIndex + 1] === undefined) {
      process.stderr.write("inkloop: --agent-reply requires a message argument\n");
      return 1;
    }
    const agentReply = flagIndex === -1 ? undefined : pollRest[flagIndex + 1];
    return runPollCommand(pollFile, agentReply === undefined ? {} : { agentReply });
  }

  if (first === "end") {
    const [endFile] = rest;
    if (!endFile) {
      process.stderr.write("inkloop: `end` requires a file argument\n\n" + HELP_TEXT);
      return 1;
    }
    return runEndCommand(endFile);
  }

  if (first === "stop") {
    return runStopCommand();
  }

  if (first === "stencil") {
    const [stencilId] = rest;
    return runStencilCommand(stencilId);
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
      process.stderr.write(
        `inkloop: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
