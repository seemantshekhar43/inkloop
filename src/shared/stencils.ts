/**
 * Static content-guidance data for `inkloop stencil` (issue #86, follow-up to #68's scoping
 * thread). Distinct from the review-loop mechanics (open/poll/end/stop): this is authoring-time
 * guidance for building the kind of artifact inkloop reviews well, served as plain data so the
 * CLI and `docs/` can both render from one source of truth rather than duplicating prose.
 *
 * Naming: "stencil" (not lavish-axi's "playbook") and its five sections (`fit`/`layout`/`rules`/
 * `snags`/`loop_notes`, not lavish-axi's `choose`/`structure`/`design_rules`/`pitfalls`/
 * `lavish_notes`) - inkloop's own vocabulary for an inkloop-specific concern, per #68/#86.
 */

export type StencilId =
  "plan" | "comparison" | "table" | "report" | "mockup" | "diagram" | "loopable";

/**
 * Cross-cutting visual-design floor (issue #89, follow-up to #86). Every stencil's `layout`/`rules`
 * describe *structure*; none said anything about *visual* baseline quality, so an agent focused on
 * content had no nudge toward a presentable result - simulating 10 stencil-guided artifacts end to
 * end produced 8 with zero CSS (default browser styling). Reachable from every `inkloop stencil <id>`
 * output (see `runStencilCommand`), not just `loopable`, since the failure mode hit table, plan,
 * report, diagram, and comparison artifacts alike, not just mockup.
 *
 * Deliberately a documented floor, not a design-system generator: a small system-font stack, a small
 * spacing scale, a neutral palette, and basic table/card/button treatment - enough that "I have no
 * design system, what do I use" has an answer instead of silence. No runtime CSS injection: any
 * styling has to live in the artifact's own HTML, authored by the agent, or the standalone-render
 * invariant (AGENTS.md) breaks - opening the saved artifact directly must render identically to
 * opening it through inkloop.
 */
export interface DesignBaseline {
  /** One-line framing: why this exists and when it applies. */
  summary: string;
  /** Priority order for picking a design direction - checked top to bottom. */
  priority: string[];
  /** Fallback typography when nothing above already answered it. */
  font_stack: string;
  /** Fallback spacing scale when nothing above already answered it. */
  spacing_scale: string;
  /** Fallback neutral/accent/status color guidance when nothing above already answered it. */
  palette: string[];
  /** Baseline treatment for the handful of components almost every artifact needs. */
  components: string[];
}

export const DESIGN_BASELINE: DesignBaseline = {
  summary:
    "Every artifact ships a real <style> block - default browser styling (serif body text, black on white, no spacing) reads as unfinished, not as a deliberate 'plain' choice. Decide the design direction before writing HTML; don't default to none.",
  priority: [
    "If the user asked for a specific look or named design system, use that.",
    "Otherwise, if the artifact represents an existing app or product, match that subject's own design system - its CSS variables/theme config, component library, brand assets, or existing styled pages - even when the artifact is authored from a different repo.",
    "Only when both come up empty, fall back to the baseline below.",
  ],
  font_stack:
    "A real system-font stack for prose (e.g. -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif), or a monospace stack for code-heavy content - never leave body text on the browser's serif default.",
  spacing_scale:
    "A small consistent scale (e.g. 4/8/12/16/24/32px) applied to margin/padding/gap throughout, not ad hoc pixel values picked per element.",
  palette: [
    "One neutral page background, one neutral surface/card color a shade off it, one body-text color with at least 4.5:1 contrast against both.",
    "One accent color used sparingly for emphasis, links, and primary actions - not applied to every heading or label.",
    "Status colors (success/warning/error) only where the content has that semantic, paired with a non-color cue - see the table/comparison stencils' snags on color-only signaling.",
  ],
  components: [
    "Cards: a border or subtle shadow plus padding, not a bare unstyled <div>.",
    "Tables: a visually distinct header row (weight/background) and row separation (dividers or zebra striping) for scanability.",
    "Buttons/links: a visible hover/focus state, not raw unstyled <a>/<button> defaults.",
  ],
};

export interface Stencil {
  id: StencilId;
  title: string;
  /** When this artifact type is the right choice for the content. */
  fit: string;
  /** How to structure it on the page. */
  layout: string;
  /** Concrete construction rules. */
  rules: string[];
  /** Common mistakes to avoid. */
  snags: string[];
  /**
   * inkloop-review-loop-specific caveats (drift-safe text anchors, standalone-render invariant,
   * scroll/draft stability across live reload) - distinct from general design taste, which lives
   * in `rules`/`snags` instead.
   */
  loop_notes: string[];
}

const STENCILS: readonly Stencil[] = [
  {
    id: "plan",
    title: "Plan",
    fit: "A sequence of steps or phases the reader needs to approve, track, or hand off - a rollout, a migration, a project timeline. Not the right choice for a single yes/no decision (use comparison) or a static reference (use report).",
    layout:
      "Ordered sections or a numbered list, one per phase or step. Lead each with a short label and outcome, not a wall of prose. A status/owner/date column per step earns its own table row rather than being buried in a sentence.",
    rules: [
      "State the goal and non-goals up front, before the steps - a reader shouldn't have to infer scope from the list.",
      "Each step names what changes and what 'done' looks like for it, not just an activity description.",
      'Surface dependencies between steps explicitly ("after step 2") rather than relying on list order alone.',
      "Keep open questions or risks in their own section, not interleaved with the steps.",
    ],
    snags: [
      "Steps that are really sub-steps of one bigger step, inflating the list without adding information.",
      'Vague verbs ("improve", "handle") in a step label where a concrete outcome should be.',
      "Mixing decided steps with speculative ones without marking which is which.",
    ],
    loop_notes: [
      "Give each step section a stable id/heading anchor (e.g. an `id` attribute matching its number) so a reviewer's text-range comment on \"step 3\" keeps its anchor if an earlier step's wording changes.",
      "The plan must render identically standalone (no inkloop server) - don't rely on injected SDK state to show which step is current.",
    ],
  },
  {
    id: "comparison",
    title: "Comparison",
    fit: "Weighing two or more options against the same criteria - libraries, vendors, architectures, naming candidates. Not the right choice for a single option's pros/cons alone (use report) or a step sequence (use plan).",
    layout:
      "A table with options as columns and criteria as rows, or criteria as columns if there are only two options and many criteria. A short verdict/recommendation section follows the table, not before it.",
    rules: [
      "Every option is scored against the same criteria set - don't let one column have extra rows the others lack.",
      "State the recommendation explicitly at the end, with the one or two criteria that decided it, rather than leaving the reader to infer a winner from the table alone.",
      "Use consistent units and phrasing across a row so cells are actually comparable at a glance.",
    ],
    snags: [
      "Criteria chosen after the fact to favor a predetermined winner - pick criteria before scoring.",
      "A table so wide it requires horizontal scrolling on a normal viewport before any collapsing/wrapping is tried.",
      "Burying the recommendation in prose instead of stating it as its own labeled line.",
    ],
    loop_notes: [
      "Wrap the table (or any content wider than the viewport) in its own `overflow-x: auto` container - the artifact body must never scroll horizontally, or a reviewer's scroll position gets lost on reload.",
      "Anchor comments to individual cells or rows via stable selectors (a `data-row`/`id` on each `<tr>`) so adding a new option column later doesn't silently shift what an existing text-range comment points at.",
    ],
  },
  {
    id: "table",
    title: "Table",
    fit: "Structured tabular data that's the point of the artifact itself - a dataset, a schedule, a reference list - rather than a comparison's side-by-side scoring. Not the right choice when the real content is prose with a table in it (use report).",
    layout:
      "One `<table>` with a clear header row; sort or group rows in the order a reader would scan them, not insertion order. Long tables (>~30 rows) get a note on how to search/filter rather than requiring a full read-through.",
    rules: [
      "Header row uses `<th>`, not styled `<td>` - screen readers and text-range anchoring both depend on it.",
      "Numeric columns are right-aligned; text columns left-aligned. Don't center everything by default.",
      "Every column has a unit in the header if its values need one, not repeated per cell.",
    ],
    snags: [
      "Merged cells (`colspan`/`rowspan`) that look fine visually but break per-cell text-range selection.",
      "A table doing a comparison's job (options as columns, criteria as rows) - that's the comparison stencil, use it instead.",
      "Sorting that only makes sense with color as the sole signal - add a text/symbol cue too.",
    ],
    loop_notes: [
      "Same horizontal-scroll containment as `comparison`: never let the table push the artifact body wider than the viewport.",
      "Keep cell text as real DOM text (not an image or canvas render of the table) so text-range selection and drift fingerprinting both work.",
    ],
  },
  {
    id: "report",
    title: "Report",
    fit: "Narrative findings with supporting evidence - an investigation writeup, a postmortem, a research summary. Not the right choice when the content is fundamentally a decision between options (use comparison) or a to-do sequence (use plan).",
    layout:
      "Lead with a short summary/verdict section, then the supporting detail in the order a reader would need it to follow the argument - not necessarily the order it was discovered in.",
    rules: [
      "State the conclusion before the evidence - don't make the reader reach the end to learn the finding.",
      "Every claim that could be double-checked cites what it's based on (a file, a log line, a measurement), not just an assertion.",
      "Keep speculation clearly marked as such, separate from what was verified.",
    ],
    snags: [
      "A finding restated three different ways across sections instead of stated once and referenced.",
      "Evidence dumped in raw form (full logs, full diffs) instead of the relevant excerpt with a pointer to the rest.",
      "No clear ending - a report that trails off without a stated conclusion or next step.",
    ],
    loop_notes: [
      'Section headings need stable ids: a reviewer commenting on "the evidence section" should keep that anchor even if the summary above it gets rewritten.',
      "If the report embeds diagrams or tables, they inherit those stencils' own loop_notes too - the report stencil governs the narrative structure, not the sub-content.",
    ],
  },
  {
    id: "mockup",
    title: "Mockup",
    fit: "A UI or product surface being proposed or reviewed for its own visual/interaction design - a screen, a component, a flow. Not the right choice for a diagram of system structure (use diagram) or a written spec (use report).",
    layout:
      "Render the actual UI, not a description of it - real HTML/CSS approximating the target surface, not a wireframe box-and-label sketch unless the review is explicitly about layout skeleton only.",
    rules: [
      "Match the target platform's real constraints (viewport width, font stack if known, spacing scale) rather than an arbitrary layout that won't transfer.",
      "State what's out of scope for this pass (e.g. \"colors are placeholder, focus on layout\") so feedback lands on what's actually being decided.",
      "Interactive elements that aren't wired up should still look inert/disabled, not clickable-looking dead ends.",
    ],
    snags: [
      "A screenshot or image of a UI pasted in instead of real rendered HTML - breaks text-range selection and can't be annotated element-by-element.",
      "Pixel-perfect polish on a version meant to validate structure only, wasting review cycles on the wrong axis.",
      "No responsive behavior at all when the target surface needs to work at multiple widths.",
    ],
    loop_notes: [
      "This is the stencil where element-level (not just text-range) annotation matters most - structure the DOM so meaningful UI regions are their own elements with stable selectors, not one flat div soup.",
      "The injected SDK's chrome must never visually blend into the mockup itself - a reviewer needs to tell inkloop's own UI apart from the UI under review at a glance (see AGENTS.md's visual-novelty non-negotiable).",
    ],
  },
  {
    id: "diagram",
    title: "Diagram",
    fit: "System structure, flow, or relationships better shown visually than described - architecture, sequence, state machine. Not the right choice for a UI review (use mockup) or tabular data (use table).",
    layout:
      "Follow the existing Mermaid pattern already documented for this repo - see AGENTS.md's \"Rendering diagrams in an artifact\" section and `docs/examples/mermaid-artifact.html` for a verified working example. This stencil doesn't repeat that guidance, it just points at it.",
    rules: [
      "Pick the Mermaid diagram type that matches the content (flowchart/sequence/state/etc.) rather than forcing everything into a flowchart.",
      "Label edges and nodes with what a reader actually needs, not internal variable/function names unless the audience is exactly that codebase's authors.",
    ],
    snags: [
      "A diagram so dense it needs its own scrollbar within the viewport before splitting into multiple smaller diagrams is tried.",
      "Auto-layout producing crossed/overlapping edges that were never checked after rendering.",
    ],
    loop_notes: [
      "The one review-loop-specific rule beyond the general Mermaid pattern: rendered SVG text must stay real DOM text nodes, not converted to paths - some Mermaid themes/renderers do this for crisper fonts, and it silently breaks text-range selection on the diagram's labels.",
    ],
  },
  {
    id: "loopable",
    title: "Loopable",
    fit: "Applies to every artifact reviewed through inkloop, regardless of which of the other six content types it is - the one cross-cutting stencil with no lavish-axi equivalent, since it's specific to inkloop's review-loop mechanics rather than content type.",
    layout:
      "No layout guidance of its own - see whichever content-type stencil applies. This stencil only covers the loop-safety properties every artifact needs on top of that.",
    rules: [
      "Semantic sectioning: real heading elements and landmark structure, not visually-styled divs - both for accessibility and because stable anchors depend on real structure.",
      "Every section a reviewer might comment on needs a stable identifying attribute (id, or a consistent selector path) that survives edits to unrelated sections.",
      "The artifact must render identically whether opened standalone (no inkloop server) or through `inkloop <file>` - never rely on injected SDK state for anything the artifact needs to show on its own.",
      "Ship a real `<style>` block with at least font, color, and spacing choices - default browser styling reads as unfinished, not as a deliberate 'plain' choice. See `design_baseline` (printed with every stencil) when there's no user-specified or subject-matched design system to follow instead.",
    ],
    snags: [
      "Regenerating a section's DOM structure (not just its text) on every revision - this invalidates every existing selector-based anchor even when the reviewer's comment is still conceptually valid.",
      "Scroll-position or in-progress draft loss across a live reload, caused by full-page re-renders instead of targeted DOM updates.",
      "Inline `<script>` that assumes the injected SDK is present (breaks the standalone-render invariant) instead of feature-detecting it.",
    ],
    loop_notes: [
      "Drift-safe text anchors: don't restructure the DOM around a text range that already has a pending or delivered comment on it if the same wording can be preserved - the SDK fingerprints the anchor's textContent and flags drift on mismatch, which is a safety net, not a reason to be careless about it.",
      "Standalone-render invariant: this is inkloop's non-negotiable (see AGENTS.md) - no stencil overrides it.",
      "Scroll/draft stability across live reload is inkloop's job on reload, but only for artifacts that don't fight it with full-page structural rewrites on every revision - see the snags above.",
    ],
  },
];

const STENCILS_BY_ID: ReadonlyMap<StencilId, Stencil> = new Map(STENCILS.map((s) => [s.id, s]));

export function listStencils(): readonly Stencil[] {
  return STENCILS;
}

export function getStencil(id: string): Stencil | undefined {
  return STENCILS_BY_ID.get(id as StencilId);
}
