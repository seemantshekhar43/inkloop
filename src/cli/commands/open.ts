import { existsSync } from "node:fs";
import path from "node:path";
import { resolveArtifactPath } from "../../shared/paths.js";
import { hashArtifactPath, openOrResumeSession } from "../../shared/session-store.js";
import { loadServerConfig } from "../../server/config.js";
import { ensureServerRunning } from "../../server/ensure-running.js";

export interface OpenCommandOptions {
  reopen?: boolean;
  cwd?: string;
}

function linkableHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

/**
 * Implements `inkloop <file>`: validate the artifact, open/resume its session, make sure a
 * server is running to serve it, and print the session URL. Returns the process exit code
 * rather than calling process.exit() directly, so it stays testable.
 */
export async function runOpenCommand(filePathArg: string, options: OpenCommandOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const reopen = options.reopen ?? false;
  const absolutePath = resolveArtifactPath(filePathArg, cwd);

  if (!existsSync(absolutePath)) {
    process.stderr.write(`inkloop: file not found: ${absolutePath}\n`);
    return 1;
  }
  if (path.extname(absolutePath).toLowerCase() !== ".html") {
    process.stderr.write(`inkloop: not an HTML file: ${absolutePath}\n`);
    return 1;
  }

  const result = await openOrResumeSession(absolutePath, { reopen });

  if (result.outcome === "refused") {
    process.stderr.write(
      "inkloop: this session was ended by the user. Re-run with --reopen if you need further review.\n",
    );
    return 1;
  }

  const config = loadServerConfig();
  await ensureServerRunning(config);

  const url = `http://${linkableHost(config.host)}:${config.port}/session/${hashArtifactPath(absolutePath)}`;
  process.stdout.write(`${url}\n`);
  return 0;
}
