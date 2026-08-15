import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLOSING_BODY_TAG = /<\/body\s*>/i;
const SDK_SCRIPT_TAG = '<script src="/sdk.js"></script>';

/**
 * Injects the SDK <script> tag into the artifact HTML at serve time only — this runs on the
 * in-memory response, never on the file on disk, so opening the saved .html directly (no
 * inkloop server running) still renders identically, per AGENTS.md's non-negotiable.
 *
 * Inserted just before </body> when present; appended at the end otherwise (the artifact may be
 * a bare HTML fragment with no <body> tag at all).
 */
export function injectSdkScript(html: string): string {
  return CLOSING_BODY_TAG.test(html)
    ? html.replace(CLOSING_BODY_TAG, `${SDK_SCRIPT_TAG}</body>`)
    : `${html}\n${SDK_SCRIPT_TAG}\n`;
}

/**
 * Resolves the compiled SDK bundle's path relative to this module, the same "works from src/ via
 * tsx or from dist/" trick used by shared/version.ts — both src/server and dist/server sit two
 * directories below the repo root, so this path is identical either way.
 */
function sdkBundlePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "dist", "sdk", "index.js");
}

export class SdkNotBuiltError extends Error {
  constructor(cause: unknown) {
    super(
      "The injected SDK bundle (dist/sdk/index.js) is missing — run `npm run build` before " +
        "serving artifacts.",
      { cause },
    );
    this.name = "SdkNotBuiltError";
  }
}

/** Reads the compiled SDK bundle's source, to be served verbatim at GET /sdk.js. */
export async function readSdkSource(): Promise<string> {
  try {
    return await readFile(sdkBundlePath(), "utf8");
  } catch (err) {
    throw new SdkNotBuiltError(err);
  }
}
