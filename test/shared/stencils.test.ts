import { test } from "node:test";
import assert from "node:assert/strict";
import { getStencil, listStencils } from "../../src/shared/stencils.js";

void test("listStencils returns the full stencil set with the ids named in issue #86", () => {
  const ids = listStencils().map((s) => s.id);
  assert.deepEqual(ids, ["plan", "comparison", "table", "report", "mockup", "diagram", "loopable"]);
});

void test("every stencil has all five non-empty sections", () => {
  for (const stencil of listStencils()) {
    assert.ok(stencil.fit.length > 0, `${stencil.id}: fit`);
    assert.ok(stencil.layout.length > 0, `${stencil.id}: layout`);
    assert.ok(stencil.rules.length > 0, `${stencil.id}: rules`);
    assert.ok(stencil.snags.length > 0, `${stencil.id}: snags`);
    assert.ok(stencil.loop_notes.length > 0, `${stencil.id}: loop_notes`);
  }
});

void test("getStencil returns the matching stencil by id", () => {
  const stencil = getStencil("diagram");
  assert.equal(stencil?.title, "Diagram");
});

void test("getStencil returns undefined for an unknown id", () => {
  assert.equal(getStencil("nonexistent"), undefined);
});
