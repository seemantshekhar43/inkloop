import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLOSING_BODY_TAG = /<\/body\s*>/gi;
const SDK_SCRIPT_TAG = '<script src="/sdk.js"></script>';

/**
 * Injects the SDK <script> tag into the artifact HTML at serve time only — this runs on the
 * in-memory response, never on the file on disk, so opening the saved .html directly (no
 * inkloop server running) still renders identically, per AGENTS.md's non-negotiable.
 *
 * Inserted just before </body> when present; appended at the end otherwise (the artifact may be
 * a bare HTML fragment with no <body> tag at all).
 *
 * Uses the *last* </body> match, not the first: an artifact can legitimately contain the literal
 * substring "</body>" before its real closing tag (a comment or code sample documenting HTML, for
 * instance — see docs/examples/mermaid-artifact.html's own header comment). A first-match replace
 * would splice the script tag into that earlier occurrence instead, where — inside an HTML
 * comment, say — it never executes and the SDK silently fails to load.
 */
export function injectSdkScript(html: string): string {
  const matches = [...html.matchAll(CLOSING_BODY_TAG)];
  const last = matches[matches.length - 1];
  if (!last) return `${html}\n${SDK_SCRIPT_TAG}\n`;
  const idx = last.index;
  return `${html.slice(0, idx)}${SDK_SCRIPT_TAG}${html.slice(idx)}`;
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
