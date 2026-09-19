import path from "node:path";

/**
 * Resolves a (possibly relative) artifact path to an absolute path, against an explicit cwd
 * rather than implicitly reading process.cwd() everywhere — keeps callers testable and makes
 * the dependency visible at the call site.
 */
export function resolveArtifactPath(filePath: string, cwd: string = process.cwd()): string {
  return path.resolve(cwd, filePath);
}
