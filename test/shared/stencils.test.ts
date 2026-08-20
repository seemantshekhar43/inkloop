import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGN_BASELINE, getStencil, listStencils } from "../../src/shared/stencils.js";

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

void test("loopable's rules ship a baseline visual-design expectation (issue #89)", () => {
  const stencil = getStencil("loopable");
  assert.ok(
    stencil?.rules.some((r) => /<style>/.test(r) && /font/i.test(r) && /color/i.test(r) && /spacing/i.test(r)),
    "loopable rules should ask for a real <style> block with font/color/spacing choices",
  );
});

void test("DESIGN_BASELINE has all non-empty sections (issue #89)", () => {
  assert.ok(DESIGN_BASELINE.summary.length > 0);
  assert.ok(DESIGN_BASELINE.priority.length > 0);
  assert.ok(DESIGN_BASELINE.font_stack.length > 0);
  assert.ok(DESIGN_BASELINE.spacing_scale.length > 0);
  assert.ok(DESIGN_BASELINE.palette.length > 0);
  assert.ok(DESIGN_BASELINE.components.length > 0);
});
