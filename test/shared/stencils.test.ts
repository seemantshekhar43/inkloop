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

void test("DESIGN_BASELINE names a component-library fallback and subject-fit note (issue #90)", () => {
  assert.ok(
    DESIGN_BASELINE.priority.some((p) => /CDN/.test(p) && /fit/i.test(p)),
    "priority should offer a CDN component-library option and warn against a mismatched default theme",
  );
});

void test("DESIGN_BASELINE's components ship a concrete example per rule (issue #90)", () => {
  for (const component of DESIGN_BASELINE.components) {
    assert.match(component, /Example:/, component);
  }
});

void test("DESIGN_BASELINE's Tables component references overflow-x safety directly (issue #90)", () => {
  const tables = DESIGN_BASELINE.components.find((c) => c.startsWith("Tables:"));
  assert.ok(tables, "expected a Tables component entry");
  assert.match(tables ?? "", /overflow-x/);
});

void test("DESIGN_BASELINE ships a mockup device-frame component (issue #99)", () => {
  const mockupFrame = DESIGN_BASELINE.components.find((c) => c.startsWith("Mockup device frame"));
  assert.ok(mockupFrame, "expected a Mockup device frame component entry");
  assert.match(mockupFrame ?? "", /mockup-browser/);
});

void test("DESIGN_BASELINE ships a dated timeline pattern distinct from the numbered step pattern (issue #99)", () => {
  const timeline = DESIGN_BASELINE.patterns.find((p) => p.startsWith("Timeline"));
  assert.ok(timeline, "expected a Timeline pattern entry");
  assert.match(timeline ?? "", /\.timeline time/);
});

void test("DESIGN_BASELINE's theming ships a concrete token-based dark-mode mechanism (issue #98)", () => {
  const theming = DESIGN_BASELINE.theming;
  assert.match(theming, /:root/);
  assert.match(theming, /@media \(prefers-color-scheme: dark\)/);
  assert.match(theming, /:not\(\[data-theme="light"\]\)/);
  assert.match(theming, /\[data-theme="dark"\]/);
  assert.match(theming, /--bg/);
  assert.match(theming, /--accent/);
});

void test("DESIGN_BASELINE has all non-empty issue #90 sections", () => {
  assert.ok(DESIGN_BASELINE.patterns.length > 0);
  assert.ok(DESIGN_BASELINE.responsive.length > 0);
  assert.ok(DESIGN_BASELINE.theming.length > 0);
  assert.ok(DESIGN_BASELINE.layout_safety.length > 0);
});
