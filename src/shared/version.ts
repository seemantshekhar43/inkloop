import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface PackageJson {
  version: string;
}

/**
 * Reads the package version from package.json relative to this module, so it works whether
 * running from source (src/) via tsx or from the compiled dist/ output.
 */
export function getVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
  return pkg.version;
}
