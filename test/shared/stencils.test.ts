import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGN_BASELINE, getStencil, listStencils } from "../../src/shared/stencils.js";

void test("listStencils returns the full stencil set with the ids named in issue #86", () => {
  const ids = listStencils().map((s) => s.id);
  assert.deepEqual(ids, [
    "plan",
    "comparison",
    "table",
    "report",
    "mockup",
    "diagram",
    "code",
    "loopable",
  ]);
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

void test("the code stencil covers per-line anchors and non-color-only diff signaling (issue #101)", () => {
  const stencil = getStencil("code");
  assert.equal(stencil?.title, "Code");
  assert.ok(
    stencil?.rules.some((r) => /color/i.test(r) && /gutter|marker|stripe/i.test(r)),
    "code rules should require more than color-only added/removed signaling",
  );
  assert.ok(
    stencil?.loop_notes.some((n) => /data-line|id/i.test(n) && /anchor/i.test(n)),
    "code loop_notes should call for a stable per-line anchor",
  );
});

void test("loopable's rules ship a baseline visual-design expectation (issue #89)", () => {
  const stencil = getStencil("loopable");
  assert.ok(
    stencil?.rules.some(
      (r) => /<style>/.test(r) && /font/i.test(r) && /color/i.test(r) && /spacing/i.test(r),
    ),
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

void test("DESIGN_BASELINE's priority prompts stating which tier was used (issue #102)", () => {
  assert.ok(
    DESIGN_BASELINE.priority.some((p) => /state which/i.test(p) && /tier/i.test(p)),
    "priority should ask the agent to state which tier it used and why when delivering the artifact",
  );
});

void test("DESIGN_BASELINE's tier disclosure clarifies it belongs in the delivery message, not the artifact page (issue #120)", () => {
  assert.ok(
    DESIGN_BASELINE.priority.some(
      (p) => /delivery message/i.test(p) && /not as visible content/i.test(p),
    ),
    "priority should clarify the tier disclosure belongs in the agent's delivery message, not baked into the artifact page",
  );
});

void test("DESIGN_BASELINE names a component-library fallback and subject-fit note (issue #90)", () => {
  assert.ok(
    DESIGN_BASELINE.priority.some((p) => /CDN/.test(p) && /fit/i.test(p)),
    "priority should offer a CDN component-library option and warn against a mismatched default theme",
  );
});

void test("DESIGN_BASELINE's tier 1 tells the agent to check for a project design.md/guideline file (issue #103)", () => {
  assert.ok(
    DESIGN_BASELINE.priority.some((p) => /design\.md/i.test(p) && /check/i.test(p)),
    "tier 1 should tell the agent to check for a project design.md/DESIGN.md/style guide before assuming none was given",
  );
});

void test("DESIGN_BASELINE's CDN tier names a concrete pinned default (issue #103)", () => {
  const cdnTier = DESIGN_BASELINE.priority.find((p) => /CDN-loaded/.test(p));
  assert.ok(cdnTier, "expected a CDN-tier priority entry");
  assert.match(cdnTier ?? "", /daisyui@5\.5\.19/);
  assert.match(cdnTier ?? "", /@tailwindcss\/browser@4\.2\.4/);
  assert.match(cdnTier ?? "", /data-theme/);
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

void test("DESIGN_BASELINE's patterns name a Mermaid diagram as an option for any stencil, not just `diagram` (issue #118)", () => {
  const diagramCrossRef = DESIGN_BASELINE.patterns.find((p) => /Mermaid/i.test(p));
  assert.ok(diagramCrossRef, "expected a pattern entry naming Mermaid as a cross-stencil option");
  assert.match(diagramCrossRef ?? "", /`diagram` stencil/);
});

void test("comparison/report/plan stencils each cross-reference the diagram stencil for structure/flow content (issue #118)", () => {
  for (const id of ["plan", "comparison", "report"] as const) {
    const stencil = getStencil(id);
    assert.ok(
      stencil?.rules.some((r) => /diagram/i.test(r) && /Mermaid/i.test(r)),
      `${id} rules should point to the diagram stencil/Mermaid when structure or flow is part of the content`,
    );
  }
});

void test("DESIGN_BASELINE ships a mockup internal-scroll-region pattern distinct from the outer device frame (issue #119)", () => {
  const scrollRegion = DESIGN_BASELINE.components.find((c) =>
    c.startsWith("Mockup internal scroll region"),
  );
  assert.ok(scrollRegion, "expected a Mockup internal scroll region component entry");
  assert.match(scrollRegion ?? "", /scrollbar-width: none/);
  assert.match(scrollRegion ?? "", /::-webkit-scrollbar/);
  assert.match(scrollRegion ?? "", /-webkit-overflow-scrolling: touch/);
});

void test("DESIGN_BASELINE's patterns name a reusable open-questions/undecided-items section for any stencil (issue #114)", () => {
  const openQuestions = DESIGN_BASELINE.patterns.find((p) => p.startsWith("Open questions"));
  assert.ok(openQuestions, "expected an open-questions/undecided-items pattern entry");
  assert.match(openQuestions ?? "", /`plan`/);
  assert.match(openQuestions ?? "", /`report`/);
  assert.match(openQuestions ?? "", /`comparison`/);
});

void test("plan/report/comparison stencils each point at the shared open-questions pattern (issue #114)", () => {
  for (const id of ["plan", "report", "comparison"] as const) {
    const stencil = getStencil(id);
    assert.ok(
      stencil?.rules.some((r) => /open.questions/i.test(r) && /issue #114/.test(r)),
      `${id} rules should reference design_baseline's open-questions pattern`,
    );
  }
});

void test("DESIGN_BASELINE ships a decision-collection-row pattern that batches structured input into one note (issue #114)", () => {
  const decisionRow = DESIGN_BASELINE.patterns.find((p) => p.startsWith("Decision-collection row"));
  assert.ok(decisionRow, "expected a Decision-collection row pattern entry");
  assert.match(decisionRow ?? "", /window\.inkloop\.addNote/);
  assert.match(decisionRow ?? "", /feature-detect/);
  assert.match(decisionRow ?? "", /row-changed/);
  // Explicitly artifact-authored JS, not a new inkloop feature requiring runtime injection -
  // consistent with the zero-runtime-injection stance the theming/CDN-default work established.
  assert.match(decisionRow ?? "", /artifact-authored JS, not a new inkloop feature/);
});
