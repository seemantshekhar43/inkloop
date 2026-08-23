# AGENTS.md

Standing instructions for any agent (or human) working in this repo. Read this before writing code.
`docs/plan.md` is the source of truth for *what* to build and why; this file is the source of truth for
*how* to work in the repo day to day.

## What this is

inkloop is a local-first CLI for human-AI collaboration on rendered HTML artifacts. See `README.md` for the
pitch and `docs/plan.md` for the full prior-art study, v1 scope, and tech stack rationale. Skim both before
starting on any issue — most design questions are already answered there.

## Non-negotiables

- **Security posture is not optional.** Loopback-only bind by default, Host-header validation against DNS
  rebinding, and no serving of files outside the artifact's own directory. This tool runs an unauthenticated
  local HTTP server; treat every route as if it will be reached by a hostile page in another tab. See issue
  #2 for the baseline and keep every later route consistent with it.
- **Zero-bloat dependency policy.** This ships as a single npm package installed ambiently via `npx` on
  every agent session. Before adding any dependency, ask whether `node:*` builtins already cover it. The
  stack decided in `docs/plan.md` §5 (plain `node:http`, no framework, no bundler, `node:test`) is
  deliberate — don't reintroduce Express/Fastify/a test framework/etc. without updating that doc first and
  explaining why the constraint no longer holds.
- **The injected browser SDK must never leak into the saved artifact.** It's injected at serve time only;
  opening the saved `.html` file directly (no inkloop server running) must render identically. Isolate any
  injected UI chrome (shadow DOM) so it can't collide with the artifact's own styles/scripts.
- **Visual novelty in the review UI.** The browser-side review chrome and the injected SDK's on-page
  affordances must not visually resemble existing tools in this space (lavish-axi, sidenote-cli,
  Percy/Chromatic reviewers). Don't default to a generic annotation-sidebar look — this needs its own
  layout, typography, and interaction direction. Applies to issues #5 and #6.
- **Portability of the core loop over new features.** If a change would complicate the open → annotate →
  queue → poll → revise → reload loop to make room for something else, it belongs in a v2 issue, not v1.
  Layout/QA detection and *editable* Mermaid whiteboards are explicitly deferred — see `docs/plan.md` §3.

## Rendering diagrams in an artifact (no inkloop support needed)

An artifact can already render a Mermaid diagram with zero help from inkloop — the artifact iframe has no
`sandbox` attribute and the server sets no CSP header (`src/server/review-shell.ts`,
`src/server/inject-sdk.ts`), and `injectSdkScript` only ever adds one `<script src="/sdk.js">` tag before
`</body>` without touching anything else in the file. So an artifact is free to bring its own self-contained
diagram-rendering script the same way it can bring any other inline CSS/JS: a `<div class="mermaid">...
</div>` block plus a `<script type="module">` that imports Mermaid's own pre-built ESM bundle from a CDN
(`https://cdn.jsdelivr.net/npm/mermaid@<version>/dist/mermaid.esm.min.mjs`) and calls `mermaid.run()` — see
`docs/examples/mermaid-artifact.html` for a verified working example (renders identically via
`inkloop <path>` and by opening the raw `.html` file directly). Because the script lives in the artifact HTML itself rather
than being injected by inkloop, this also satisfies the "standalone artifact still renders identically"
non-negotiable for free. Don't add Mermaid (or any other renderer) as an inkloop dependency for this — it's
the artifact author's concern, not inkloop's. Mermaid itself is MIT-licensed (free, no
attribution/fee obligations beyond the license notice bundled in the library), and since it's
loaded from the artifact's own script rather than from inkloop's `package.json`, it never
becomes an inkloop dependency or license obligation either way. See issue #33.

If the artifact supports a dark-mode/theme toggle (the `design_baseline.theming` mechanism from
issue #98 — CSS custom properties plus a `data-theme` attribute override), the Mermaid diagram
must re-render on theme change too, not just render once at whatever theme was active on first
paint (issue #100, follow-up to #97 — this one's closer to a real bug than a taste gap, since
`design_baseline.theming` already permits an artifact to support dark mode). `mermaid.run()`
marks each node `data-processed` after rendering and won't re-render it a second time, so keep
the original diagram source around (e.g. in a `data-src` attribute) and restore it before calling
`mermaid.run()` again. Resolve the theme the same way the page itself would — an explicit
`data-theme` attribute first, `prefers-color-scheme` otherwise — and re-resolve/re-render on a
`matchMedia("(prefers-color-scheme: dark)")` change event and on a `MutationObserver` watching
`data-theme`/`class`/`style` on `<html>`. See `docs/examples/mermaid-artifact.html` for the full
worked pattern, including a theme-toggle button that exercises it.

## Seeding suggested reviewer prompts (no inkloop support needed, issue #73)

The review shell offers a few starter prompts above the composer on first open, instead of a
blank box. An artifact can seed these itself, the same "no inkloop support needed" pattern as the
Mermaid example above: a plain
```html
<script type="application/json" id="inkloop-suggestions">
  ["Explain the reasoning behind the pricing table.", "Is the hero image accessible?"]
</script>
```
tag anywhere in the artifact's `<body>`, inert to any browser that doesn't know to look for it, so
opening the saved `.html` file directly still renders identically. The injected SDK
(`src/sdk/index.ts`) reads it (up to 2 strings, each capped in length) and hands it to the review
shell; if it's absent, malformed, or empty, the SDK falls back to its own DOM heuristics, ordered
most-actionable first (missing alt text, unhandled form validation, an over-long paragraph, a
section heading) instead of showing nothing.

Deliberately *not* an inkloop-side LLM call: the agent that just wrote the artifact is already the
one best placed to know what's worth asking about it, and generating the prompts itself avoids
adding inkloop's first cloud dependency, an API key requirement, a per-open cost, and a privacy
question (the artifact's content leaving the browser) — all for a call whose output the artifact's
own author could just... write down while it's already there.

## Dev workflow

```
npm install
npm run check   # lint + typecheck + test — the single local gate, run before every commit
npm run build   # compiles src/ to dist/
npm run dev     # runs the CLI from source via ts-node/tsx for manual testing
```

Directory layout:
```
src/
  cli/      entry point, argument parsing, one file per subcommand
  server/   node:http server, routing, session HTTP handlers
  sdk/      injected browser SDK (compiled to a single IIFE, zero deps)
  shared/   types and pure logic shared across cli/server/sdk (session store, fingerprinting, etc.)
test/       node:test files, mirroring src/'s directory structure 1:1 (test/server/foo.test.ts
            covers src/server/foo.ts). src/ is production-only; keep it that way.
```

## GitHub issue workflow (follow this for every change)

1. **Every unit of work is a tracked issue**, labeled `v1` for the current milestone. Check
   `gh-axi issue list --label v1` for the backlog before starting anything new; file a new issue for
   anything not already covered rather than doing untracked work.
2. **Branch per issue**: `git checkout -b issue-<n>-<short-slug>` off `main`.
3. Implement, with tests. `node:test` files live under `test/`, mirroring the path of the `src/` module
   they cover (e.g. `src/shared/paths.ts` -> `test/shared/paths.test.ts`), importing from `src/` via
   relative path. Don't colocate test files inside `src/`.
4. **Run `npm run check` locally before considering the issue done.**
5. **Gate with the `no-mistakes` skill before pushing or opening a PR, and before merging** — it runs review,
   tests, lint, docs, and is meant to drive the push/PR/CI flow itself, not just be run against a branch
   already pushed by hand. Do not push, open a PR, or hand-merge around it. This is a hard requirement for
   this repo, not an optional extra pass: security bugs in an unauthenticated local HTTP server are exactly
   the class of mistake it's designed to catch.
6. Once the PR is green and merged, **close the issue** (`gh-axi issue close <n>` if not auto-closed by a
   `Closes #<n>` line in the PR body — prefer the `Closes #<n>` line so it's automatic).
7. Update `docs/plan.md` in the same PR if the work changes a decision recorded there. Never leave a stale
   decision on record next to code that contradicts it.

## Testing philosophy

- Unit test the pure modules (`shared/`) directly — no server needed.
- Integration-test the server by starting it on an ephemeral port and issuing real HTTP requests
  (`node:http` client, no supertest-style dependency).
- Anything security-relevant (Host header validation, path traversal on artifact serving, session-key
  derivation) gets an explicit negative test, not just a happy-path one.

## What "done" means for v1

The full v1 backlog is issues #1–#10 in this repo. When all are closed, the core loop (open → annotate →
queue → poll → revise → reload → end) should work end to end with no layout/QA inbox and no Mermaid editing
— those are v2, tracked separately once v1 ships. See `docs/plan.md` §3 for the full rationale.
