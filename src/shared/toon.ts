/**
 * Minimal, hand-rolled TOON (Token-Oriented Object Notation, toonformat.dev) encoder for
 * inkloop's agent-facing CLI output (issue #15): `inkloop poll`'s `items` batch and the flat
 * `{status, endedBy, next_step}`-shaped payloads `poll`/`end` emit when a session has ended.
 * TOON declares a uniform array's field list once in a header and streams one row per line,
 * instead of repeating every key as JSON does per object — the exact win for a batch of
 * similarly-shaped feedback items.
 *
 * This is deliberately *not* a general JSON<->TOON codec (see AGENTS.md's zero-bloat dependency
 * policy): it covers only what inkloop's four fixed output shapes need — flat objects of
 * string/number/boolean/null values, and a single tabular array of uniform flat rows — and it
 * only ever *encodes*. inkloop never decodes TOON: the reader on the other end is the agent's
 * own model reading stdout directly, the same way it already reads today's JSON output.
 *
 * Kept spec-faithful (quoting/escaping rules in particular) by golden-testing this module
 * byte-for-byte against the reference `@toon-format/toon` package — see
 * test/shared/toon.golden.test.ts. That package is a devDependency only (zero runtime
 * dependencies itself); it never ships in the published `inkloop` package, which publishes only
 * `dist` (see package.json's "files").
 */

/** A single TOON cell/field value. `null` stands in for "this optional field doesn't apply to
 * this row" — TOON has no per-row way to omit a declared column, unlike JSON's `undefined`. */
export type ToonPrimitive = string | number | boolean | null;

/** One row of a tabular array, or a flat root object — every row of a given table must supply
 * the same set of keys, in the same order, so the header's field list applies to every line. */
export type ToonRow = Record<string, ToonPrimitive>;

const DELIMITER = ",";
const NUMERIC_LIKE_PATTERN = /^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const VALID_UNQUOTED_KEY = /^[A-Za-z_][\w.]*$/;

function isBooleanOrNullLiteral(token: string): boolean {
  return token === "true" || token === "false" || token === "null";
}

function isNumericLike(value: string): boolean {
  return NUMERIC_LIKE_PATTERN.test(value);
}

/** Mirrors @toon-format/toon's escapeString exactly (spec §7.1): only `\\ " \n \r \t` get a
 * short escape, every other control char (U+0000-U+001F) becomes `\uXXXX`. */
function escapeString(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      // eslint-disable-next-line no-control-regex -- intentional: spec 7.1 requires escaping every remaining control char.
      .replace(/[\u0000-\u001F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
  );
}

/** Mirrors @toon-format/toon's isSafeUnquoted (spec §7.2): a string can skip quotes only if
 * none of these ambiguity risks apply. */
function isSafeUnquoted(value: string): boolean {
  if (!value) return false;
  if (/^[ \t]|[ \t]$/.test(value)) return false;
  if (isBooleanOrNullLiteral(value) || isNumericLike(value)) return false;
  if (value.includes(":")) return false;
  if (value.includes('"') || value.includes("\\")) return false;
  if (/[[\]{}]/.test(value)) return false;
  // eslint-disable-next-line no-control-regex -- same rationale as escapeString above.
  if (/[\u0000-\u001F]/.test(value)) return false;
  if (value.includes(DELIMITER)) return false;
  if (value.startsWith("-")) return false;
  if (value.startsWith("#")) return false;
  return true;
}

function encodeStringLiteral(value: string): string {
  return isSafeUnquoted(value) ? value : `"${escapeString(value)}"`;
}

function encodePrimitive(value: ToonPrimitive): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return encodeStringLiteral(value);
}

function encodeKey(key: string): string {
  return VALID_UNQUOTED_KEY.test(key) ? key : `"${escapeString(key)}"`;
}

/** Encodes a flat root object of scalar key/value pairs as one `key: value` line per field, in
 * the object's own key order — the shape `inkloop end` (and `inkloop poll`'s ended-session tail)
 * emits. */
export function encodeToonObject(fields: ToonRow): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeKey(key)}: ${encodePrimitive(value)}`)
    .join("\n");
}

/**
 * Encodes a tabular array of uniform flat rows under `key` — TOON's `key[N]{f1,f2,...}:` form
 * (spec §9.3), field list taken from the first row's key order. Every row must already carry
 * every column (`null` for a field that doesn't apply — see ToonPrimitive) so the header's field
 * list holds for every line; callers normalize rows to a fixed shape before calling this rather
 * than this function inferring/reconciling columns itself. Returns `key: []` for an empty array,
 * matching the reference encoder's empty-array form.
 */
export function encodeToonTable(key: string, rows: ToonRow[]): string {
  if (rows.length === 0) return `${encodeKey(key)}: []`;
  const fields = Object.keys(rows[0] as ToonRow);
  const header = `${encodeKey(key)}[${rows.length}]{${fields.map(encodeKey).join(DELIMITER)}}:`;
  const lines = rows.map(
    (row) => `  ${fields.map((field) => encodePrimitive(row[field] ?? null)).join(DELIMITER)}`,
  );
  return [header, ...lines].join("\n");
}
