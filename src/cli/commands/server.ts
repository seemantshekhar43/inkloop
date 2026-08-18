import { loadServerConfig } from "../../server/config.js";
import { createInkloopServer } from "../../server/create-server.js";

/**
 * Runs the server in the foreground and never returns while it's up — the listening HTTP
 * server keeps the event loop alive on its own. This is what `ensure-running.ts` spawns
 * detached in the background; it is not meant to be run directly by a human, hence the `__`
 * prefix keeping it out of --help.
 */
export async function runServerCommand(): Promise<never> {
  const config = loadServerConfig();
  const instance = createInkloopServer(config, (reason) => {
    process.stderr.write(
      reason === "idle"
        ? "[inkloop] idle timeout reached, shutting down\n"
        : "[inkloop] stop requested, shutting down\n",
    );
    process.exit(0);
  });
  const port = await instance.listening;
  process.stderr.write(`[inkloop] server listening on ${config.host}:${port}\n`);
  return new Promise<never>(() => {
    // Intentionally never resolves — the process stays alive via the listening server and
    // the idle-timeout handler above is the only thing that exits it.
  });
}
