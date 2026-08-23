import { test } from "node:test";
import assert from "node:assert/strict";
import { encode } from "@toon-format/toon";
import { encodeToonObject, encodeToonTable, type ToonRow } from "../../src/shared/toon.js";

/**
 * Golden tests (issue #15): assert our hand-rolled encoder produces byte-for-byte identical
 * output to the reference `@toon-format/toon` package (a devDependency only — see toon.ts's
 * header comment and AGENTS.md's zero-bloat policy) for the exact payload shapes `inkloop
 * poll`/`inkloop end` emit. This is what keeps the hand-rolled quoting/escaping rules honest
 * against real TOON rather than a private dialect an agent's training never saw.
 */

function feedbackRow(overrides: Partial<ToonRow> = {}): ToonRow {
  return {
    id: "item-1",
    target_kind: "general",
    target_selector: null,
    target_startOffset: null,
    target_endOffset: null,
    target_quote: null,
    target_fingerprint: null,
    comment: "looks good",
    createdAt: "2026-08-23T10:00:00.000Z",
    deliveredAt: null,
    claimedAt: null,
    round: null,
    drifted: null,
    driftedAt: null,
    ...overrides,
  };
}

void test("matches reference encoder for a mixed batch of feedback items", () => {
  const rows = [
    feedbackRow(),
    feedbackRow({
      id: "item-2",
      target_kind: "element",
      target_selector: "#hero",
      comment: "move this up, please",
      round: 1,
      drifted: false,
    }),
    feedbackRow({
      id: "item-3",
      target_kind: "text-range",
      target_selector: ".p",
      target_startOffset: 3,
      target_endOffset: 20,
      target_quote: 'the quick fox, "jumps"',
      target_fingerprint: "ab12cd34",
      comment: 'fix "this" wording',
      round: 2,
      drifted: true,
      driftedAt: "2026-08-23T10:05:00.000Z",
      deliveredAt: "2026-08-23T10:06:00.000Z",
      claimedAt: "2026-08-23T10:05:59.000Z",
    }),
  ];
  const nextStep = "run `inkloop poll <file>` again once you've revised";

  const mine = `${encodeToonTable("items", rows)}\n${encodeToonObject({ next_step: nextStep })}`;
  const ref = encode({ items: rows, next_step: nextStep });
  assert.equal(mine, ref);
});

void test("matches reference encoder for an empty items array plus an ended tail", () => {
  const nextStep =
    "The user ended this session from the browser. A later `inkloop <file>` will refuse to reopen it unless run with --reopen.";

  const mine = `${encodeToonTable("items", [])}\n${encodeToonObject({ ended: true, endedBy: "user", next_step: nextStep })}`;
  const ref = encode({ items: [], ended: true, endedBy: "user", next_step: nextStep });
  assert.equal(mine, ref);
});

void test("matches reference encoder for `inkloop end`'s flat object", () => {
  const nextStep =
    "You ended this session. A later `inkloop <file>` may reopen it freely if further review is needed.";

  const mine = encodeToonObject({ status: "ended", endedBy: "agent", next_step: nextStep });
  const ref = encode({ status: "ended", endedBy: "agent", next_step: nextStep });
  assert.equal(mine, ref);
});

void test("matches reference encoder on strings that trigger quoting/escaping", () => {
  const rows = [
    feedbackRow({
      id: "-weird",
      target_kind: "#tag",
      target_selector: "42",
      target_quote: "a:b",
      comment: "line1\ntab\there\r\nand a backslash \\ and \"quotes\"",
      createdAt: "not-a-real-date-but-still-a-string",
    }),
  ];

  const mine = encodeToonTable("items", rows);
  const ref = encode({ items: rows });
  assert.equal(mine, ref);
});

void test("matches reference encoder on a comment containing the delimiter, colons, and brackets", () => {
  const rows = [
    feedbackRow({
      comment: "use [primary, secondary] colors here: not the current one {accent}",
    }),
  ];

  const mine = encodeToonTable("items", rows);
  const ref = encode({ items: rows });
  assert.equal(mine, ref);
});

void test("matches reference encoder for a single-item batch (no trailing rows)", () => {
  const rows = [feedbackRow()];
  const mine = encodeToonTable("items", rows);
  const ref = encode({ items: rows });
  assert.equal(mine, ref);
});
