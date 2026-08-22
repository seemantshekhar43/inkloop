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
  "plan" | "comparison" | "table" | "report" | "mockup" | "diagram" | "code" | "loopable";

/**
 * Cross-cutting visual-design floor (issue #89, follow-up to #86). Every stencil's `layout`/`rules`
 * describe *structure*; none said anything about *visual* baseline quality, so an agent focused on
 * content had no nudge toward a presentable result - simulating 10 stencil-guided artifacts end to
 * end produced 8 with zero CSS (default browser styling). Reachable from every `inkloop stencil <id>`
 * output (see `runStencilCommand`), not just `loopable`, since the failure mode hit table, plan,
 * report, diagram, and comparison artifacts alike, not just mockup.
 *
 * Extended by issue #90 (follow-up to #89): re-simulating the same 10 artifacts post-#89 confirmed
 * the zero-CSS failure was gone, but scored consistently lower on UI quality (7.54/10 avg) than an
 * equivalent artifact built from lavish-axi's static design guidance (8.21/10 avg) across 9 of 10
 * briefs - the recurring, evidenced gaps were: no component-library fallback ever named as an option,
 * no concrete example per component (prose rules only), no responsive-breakpoint starting pattern, no
 * dark-mode/theme-variant prompt, no stencil-specific component patterns (a plan's step/timeline, a
 * dashboard's stat/KPI tile, a status-color-to-semantic worked example), and the table stencil's own
 * overflow-x safety note not being reachable from design_baseline's generic Tables bullet. The one
 * brief where inkloop's hand-authored baseline won outright did so because lavish's recommended
 * default theme didn't fit that artifact's subject - hence `priority`'s CDN option below is explicit
 * about picking a fitting palette, not one fixed default.
 *
 * Deliberately a documented floor, not a design-system generator: a small system-font stack, a small
 * spacing scale, a neutral palette, and basic table/card/button treatment - enough that "I have no
 * design system, what do I use" has an answer instead of silence. No runtime CSS injection: any
 * styling has to live in the artifact's own HTML, authored by the agent, or the standalone-render
 * invariant (AGENTS.md) breaks - opening the saved artifact directly must render identically to
 * opening it through inkloop. A CDN component library is named as one *available* option below (per
 * the existing Mermaid-CDN precedent in AGENTS.md: "the artifact author's concern, not inkloop's"),
 * not a required dependency - inkloop itself still adds nothing.
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
  /** Baseline treatment for the handful of components almost every artifact needs, each with a concrete example. */
  components: string[];
  /** Component patterns that recur for specific content shapes (steps, stat tiles, code/log excerpts). */
  patterns: string[];
  /** Concrete responsive-breakpoint starting point, not just the general "must be responsive" snag. */
  responsive: string;
  /** Whether/how to consider a dark-mode or theme-variant path, mirroring the mockup stencil's "state what's out of scope" pattern. */
  theming: string;
  /** Copy-paste CSS to prevent nested-layout overflow, reused across artifacts instead of reinvented. */
  layout_safety: string;
}

export const DESIGN_BASELINE: DesignBaseline = {
  summary:
    "Every artifact ships a real <style> block - default browser styling (serif body text, black on white, no spacing) reads as unfinished, not as a deliberate 'plain' choice. Decide the design direction before writing HTML; don't default to none.",
  priority: [
    "If the user asked for a specific look or named design system, use that - including a project's own docs/design.md, DESIGN.md, style guide, or similar written design guideline, if one exists; check for it before assuming none was given.",
    "Otherwise, if the artifact represents an existing app or product, match that subject's own design system - its CSS variables/theme config, component library, brand assets, or existing styled pages - even when the artifact is authored from a different repo.",
    'Otherwise - no design.md/guideline was found and the subject has no design system of its own to match - a CDN-loaded component library is an available option, the same way an artifact can already bring its own Mermaid CDN script (see AGENTS.md). Default (issue #103, follow-up to #97): Tailwind CSS\'s browser runtime plus DaisyUI\'s component classes, pinned versions, dropped straight into `<head>` with no build step - `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/daisyui.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/themes.css"><script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4/dist/index.global.js"></script>` - the same pinned versions already verified working in this repo\'s own `docs/plan.html`. This is a starting point, not a fixed theme: pick one of DaisyUI\'s named `data-theme` values (e.g. `corporate`, `dracula`, `nord`) or override its CSS custom properties to actually fit the artifact\'s subject - a mismatched theme (e.g. a luxury/finance look on a fitness-tracker dashboard) reads worse than the plain baseline below, and was the one case in #90 where inkloop\'s hand-authored baseline beat this same kind of default outright. Re-pinning these two version numbers as Tailwind/DaisyUI ship new majors is this baseline\'s own maintenance, not inkloop\'s dependency tree - it never touches `package.json`.',
    "Only when all of the above come up empty, fall back to the baseline in this reference.",
    'When delivering the artifact, state which of the above tiers was used and why (issue #102, follow-up to #97) - e.g. "used tier 2: matched the subject app\'s existing Tailwind config" or "used tier 4: baseline, no user spec or existing design system found" - a cheap checkpoint against silently skipping straight to the baseline instead of actually checking the earlier tiers first. This disclosure belongs in the agent\'s delivery message/reply to the reviewer (e.g. via `--agent-reply` or the initial handoff) - not as visible content baked into the artifact page itself, where it persists as a permanent callout an end-viewer has no use for (issue #120). The one exception is a stencil whose audience is itself internal/engineering-facing (e.g. a `comparison` or `report` doc reviewed by the team that cares about tooling choices) - there, keeping it on the page can be the right call.',
  ],
  font_stack:
    "A real system-font stack for prose (e.g. -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif), or a monospace stack for code-heavy content - never leave body text on the browser's serif default.",
  spacing_scale:
    "A small consistent scale (e.g. 4/8/12/16/24/32px) applied to margin/padding/gap throughout, not ad hoc pixel values picked per element.",
  palette: [
    "One neutral page background, one neutral surface/card color a shade off it, one body-text color with at least 4.5:1 contrast against both.",
    "One accent color used sparingly for emphasis, links, and primary actions - not applied to every heading or label.",
    'Status colors (success/warning/error) only where the content has that semantic, paired with a non-color cue - see the table/comparison stencils\' snags on color-only signaling. Map color to favorability, not magnitude or urgency (e.g. a "high satisfaction" rating is success-green; a "high risk" rating is error-red) - the two easily get inverted when named after the metric instead of the verdict.',
  ],
  components: [
    "Cards: a border or subtle shadow plus padding, not a bare unstyled <div>. Example: `.card { padding: 16px; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 1px 2px rgba(0,0,0,.06); }`.",
    "Tables: a visually distinct header row (weight/background) and row separation (dividers or zebra striping) for scanability, wrapped in its own `overflow-x: auto` container regardless of stencil - see the table/comparison stencils' loop_notes for why. Example: `.table-wrap { overflow-x: auto; } th { text-align: left; font-weight: 600; background: var(--surface); } tbody tr:nth-child(even) { background: var(--surface); }`.",
    "Buttons/links: a visible hover/focus state, not raw unstyled <a>/<button> defaults. Example: `button { padding: 8px 16px; border-radius: 6px; background: var(--accent); color: #fff; border: none; } button:hover { filter: brightness(1.08); } button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.",
    'Mockup device frame (the `mockup` stencil\'s starting point, issue #99 follow-up to #97): a browser-chrome bar above the rendered UI so a reviewer can tell the frame from the surface under review at a glance, not a bare unstyled container. Example: `.mockup-browser { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; } .mockup-browser__bar { display: flex; gap: 6px; padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border); } .mockup-browser__dot { width: 10px; height: 10px; border-radius: 50%; background: var(--border); } .mockup-browser__body { padding: 16px; background: var(--bg); }` with three `<span class="mockup-browser__dot">` in the bar.',
    'Mockup internal scroll region (issue #119, follow-up to #99): a scrollable content area *inside* a device-frame mockup (a phone mockup\'s expense list, a groups list) has its own concerns beyond the outer frame above - clip to the frame\'s rounded corners, hide the scrollbar cross-browser, and keep a native momentum-scroll feel, so an internal list doesn\'t break the native-device illusion with a visible desktop scrollbar. Example: `.mockup-scroll { overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; scrollbar-width: none; } .mockup-scroll::-webkit-scrollbar { display: none; }` - both `scrollbar-width: none` (Firefox) and `::-webkit-scrollbar { display: none; }` (Chrome/Safari) are needed together, and the scroll region sits inside the frame\'s own `overflow: hidden` boundary so content doesn\'t spill past the device\'s rounded corners.',
  ],
  patterns: [
    'Step/phase indicator (the `plan` stencil\'s defining visual element): a numbered vertical or horizontal rail, not prose-only steps. Example: a `<ol class="steps">` with `.steps { position: relative; padding-left: 28px; } .steps::before { content: ""; position: absolute; left: 9px; top: 0; bottom: 0; width: 2px; background: var(--border); } .steps li::before { content: attr(data-n); position: absolute; left: -28px; width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; }`.',
    "Stat/KPI tile row (dashboards, executive summaries): a row of labeled numbers above the detail, each with a label/value/optional trend - gives a reader an at-a-glance summary before the supporting detail, not just a wall of cards.",
    "Code/log excerpt block: a monospace block with its own background distinct from prose (e.g. `background: var(--surface); font-family: ui-monospace, monospace; padding: 12px; border-radius: 6px; overflow-x: auto;`), not plain text dropped inline with body copy.",
    'Timeline (dated events, as opposed to the numbered step/phase pattern above - issue #99 follow-up to #97): a horizontal or vertical rail with a date label per entry rather than a sequence number, for content that\'s chronological but not a to-do sequence (a changelog, a history section in a report). Example: `<ul class="timeline">` with `.timeline { position: relative; padding-left: 28px; } .timeline::before { content: ""; position: absolute; left: 9px; top: 0; bottom: 0; width: 2px; background: var(--border); } .timeline li { position: relative; padding-bottom: 20px; } .timeline li::before { content: ""; position: absolute; left: -23px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); } .timeline time { display: block; font-size: 12px; color: var(--text); opacity: .7; }`.',
    "Architecture/flow diagram (issue #118, follow-up to #97): available for *any* stencil, not just the `diagram` stencil - when the content being compared/reported/planned has structure, flow, or relationships that a table or prose paragraph would only describe, a Mermaid diagram often clarifies it faster (e.g. a comparison's recommended stack shown as a flowchart of how the pieces connect end to end). See the `diagram` stencil for the concrete rendering pattern (AGENTS.md's \"Rendering diagrams in an artifact\" section); this bullet exists so that guidance is reachable without first guessing to open the `diagram` stencil.",
  ],
  responsive:
    "Start from one breakpoint around 640-720px that collapses multi-column layouts (grids, side-by-side cards, wide tables) to a single column or a horizontally-scrolling container, rather than inventing a threshold from scratch each time. Add more breakpoints only if the content genuinely needs them.",
  theming:
    'Dark mode/theme variants are not required, but state the decision rather than leaving it silent: either support one or note in the artifact that it\'s light-only for this pass - mirrors the mockup stencil\'s "state what\'s out of scope" rule. When supporting one, use this worked mechanism (issue #98, follow-up to #90) rather than inventing a new one - it\'s the same convention `components`/`patterns` above already assume when their examples reference `var(--border)`/`var(--surface)`/`var(--accent)`: define the tokens once as CSS custom properties on `:root` (`--bg`, `--surface`, `--text`, `--border`, `--accent`), redefine only those tokens\' values under `@media (prefers-color-scheme: dark)`, and if an explicit toggle is wanted, add a guarded `@media` selector plus a matching `[data-theme="dark"]` block so a script can force either theme regardless of OS preference - guard the media query with `:not([data-theme="light"])` or an explicit `data-theme="dark"` override never wins outright when the OS is already dark. Every other rule stays a token reference, so a theme swap changes values in one place, not markup elsewhere. Example: `:root { --bg: #fff; --surface: #f6f6f7; --text: #1a1a1a; --border: #e2e2e5; --accent: #3b6ef6; } @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #16161a; --surface: #1f1f24; --text: #e8e8ea; --border: #33333a; --accent: #7aa2ff; } } :root[data-theme="dark"] { --bg: #16161a; --surface: #1f1f24; --text: #e8e8ea; --border: #33333a; --accent: #7aa2ff; } body { background: var(--bg); color: var(--text); }`.',
  layout_safety:
    "Copy-paste when nesting grid/flex layouts, badges, or wide monospace content: `*, *::before, *::after { box-sizing: border-box; } .grid > *, .flex > * { min-width: 0; } p, li, td, th { overflow-wrap: anywhere; } img, svg, video { max-width: 100%; height: auto; }` - prevents a nested child or an unbreakable token from silently pushing the artifact wider than the viewport.",
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
      "If steps hand off between systems or components (not just between people/time), consider a Mermaid diagram alongside the step list (see the `diagram` stencil and `design_baseline`'s patterns, issue #118) - a step list shows order, not architecture.",
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
      "If the options being compared fit together as pieces of a larger system (e.g. a recommended stack), consider a Mermaid diagram showing how they connect, alongside the table (see the `diagram` stencil and `design_baseline`'s patterns, issue #118) - a comparison table scores options, it doesn't show how the winner fits end to end.",
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
    fit: "Narrative findings with supporting evidence - an investigation writeup, a postmortem, a research summary. Not the right choice when the content is fundamentally a decision between options (use comparison), a to-do sequence (use plan), or a diff/patch review (use code).",
    layout:
      "Lead with a short summary/verdict section, then the supporting detail in the order a reader would need it to follow the argument - not necessarily the order it was discovered in.",
    rules: [
      "State the conclusion before the evidence - don't make the reader reach the end to learn the finding.",
      "Every claim that could be double-checked cites what it's based on (a file, a log line, a measurement), not just an assertion.",
      "Keep speculation clearly marked as such, separate from what was verified.",
      "If the findings describe how components or systems relate (a root cause's data flow, an architecture involved in a postmortem), consider a Mermaid diagram alongside the narrative (see the `diagram` stencil and `design_baseline`'s patterns, issue #118) - prose describes a flow, a diagram shows it.",
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
    fit: "A UI or product surface being proposed or reviewed for its own visual/interaction design - a screen, a component, a flow. Not the right choice for a diagram of system structure (use diagram), a written spec (use report), or a diff/patch review (use code).",
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
    id: "code",
    title: "Code",
    fit: "Reviewing a diff, patch, or before/after source snippet - a PR's changes, a proposed refactor, a migration script. Not the right choice for prose findings about the code (use report) or a full rendered UI (use mockup).",
    layout:
      "A unified or side-by-side diff, monospace throughout. Group multiple files/hunks under their own labeled heading rather than concatenating them with no separator. Lead with a one-line summary of what changed and why before the diff itself, the same 'conclusion before evidence' rule as the report stencil.",
    rules: [
      "Added and removed lines are visually distinct by more than color alone - a leading `+`/`-` gutter marker or background stripe plus the color, per the palette's status-color rule: color-only signaling fails the same reader a table/comparison's color-only snag would.",
      "Every line of code is real DOM text, one line per element (e.g. one `<span>`/`<div>` per line), not an image or canvas render of the diff - required for text-range selection and per-line anchoring.",
      "Unchanged context lines around a hunk are visually de-emphasized (dimmer, not hidden) so the reader's eye still finds the actual change first.",
      "Syntax highlighting is optional; if omitted, the block still gets the code/log excerpt pattern's monospace background treatment so it doesn't read as unstyled plain text.",
    ],
    snags: [
      "A screenshot or pasted image of a diff instead of real text - breaks selection and search the same way a mockup screenshot does.",
      "Truncating a long diff with no indication more exists, versus explicitly noting what was cut and why.",
      "Whitespace-only or reformatting-only hunks left undistinguished from substantive changes, burying the real diff in noise.",
    ],
    loop_notes: [
      "Give each line a stable per-line anchor (e.g. `data-line` or `id`) the same way the table/comparison stencils anchor per-cell/per-row, so a reviewer's comment on one line survives an edit to a different line in the same hunk.",
      "If a revision changes the diff's line count, don't renumber every existing anchor to close the gap - anchors are stable identifiers, not display positions.",
    ],
  },
  {
    id: "loopable",
    title: "Loopable",
    fit: "Applies to every artifact reviewed through inkloop, regardless of which of the other seven content types it is - the one cross-cutting stencil with no lavish-axi equivalent, since it's specific to inkloop's review-loop mechanics rather than content type.",
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
