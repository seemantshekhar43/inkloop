# AGENTS.md

Standing instructions for any agent (or human) working in this repo. Read this before writing code.
This file is the source of truth for the standing rules and non-negotiables that are specific to working
on inkloop as an agent; see `CONTRIBUTING.md` for local setup, the build/test/lint commands, and how to
exercise the CLI end to end.

## What this is

inkloop is a local-first CLI for human-AI collaboration on rendered HTML artifacts. See `README.md` for
the pitch, the core loop, and the tech stack.

## Non-negotiables

- **Security posture is not optional.** Loopback-only bind by default, Host-header validation against DNS
  rebinding, and no serving of files outside the artifact's own directory. This tool runs an unauthenticated
  local HTTP server; treat every route as if it will be reached by a hostile page in another tab. Keep
  every route consistent with this baseline.
- **Zero-bloat dependency policy.** This ships as a single npm package installed ambiently via `npx` on
  every agent session. Before adding any dependency, ask whether `node:*` builtins already cover it. The
  stack (plain `node:http`, no framework, no bundler, `node:test`) is deliberate - don't reintroduce
  Express/Fastify/a test framework/etc. without a clear reason the constraint no longer holds.
- **The injected browser SDK must never leak into the saved artifact.** It's injected at serve time only;
  opening the saved `.html` file directly (no inkloop server running) must render identically. Isolate any
  injected UI chrome (shadow DOM) so it can't collide with the artifact's own styles/scripts.
- **Visual novelty in the review UI.** The browser-side review chrome and the injected SDK's on-page
  affordances must not visually resemble existing annotation/review tools in this space. Don't default to
  a generic annotation-sidebar look - this needs its own layout, typography, and interaction direction.
  Applies to the review shell and the injected SDK.
- **Portability of the core loop over new features.** If a change would complicate the open → annotate →
  queue → poll → revise → reload loop to make room for something else, it belongs in a later, separately
  tracked issue, not this one. A passive layout/QA issue inbox and *editable* Mermaid whiteboards are
  explicitly out of scope for the core loop - see the "v1 scope" section of `README.md`.

## Rendering diagrams in an artifact (no inkloop support needed)

An artifact can already render a Mermaid diagram with zero help from inkloop - the artifact iframe has no
`sandbox` attribute and the server sets no CSP header (`src/server/review-shell.ts`,
`src/server/inject-sdk.ts`), and `injectSdkScript` only ever adds one `<script src="/sdk.js">` tag before
`</body>` without touching anything else in the file. So an artifact is free to bring its own self-contained
diagram-rendering script the same way it can bring any other inline CSS/JS: a `<div class="mermaid">...
</div>` block plus a `<script type="module">` that imports Mermaid's own pre-built ESM bundle from a CDN
and calls `mermaid.run()`. Because the script lives in the artifact HTML itself rather than being injected
by inkloop, this also satisfies the "standalone artifact still renders identically" non-negotiable for
free. Don't add Mermaid (or any other renderer) as an inkloop dependency for this - it's the artifact
author's concern, not inkloop's. Mermaid itself is MIT-licensed (free, no attribution/fee obligations
beyond the license notice bundled in the library), and since it's loaded from the artifact's own script
rather than from inkloop's `package.json`, it never becomes an inkloop dependency or license obligation
either way.

If the artifact supports a dark-mode/theme toggle (CSS custom properties plus a `data-theme` attribute
override), the Mermaid diagram must re-render on theme change too, not just render once at whatever theme
was active on first paint - this is closer to a real correctness bug than a taste gap, since a
theme-aware artifact is explicitly allowed to support dark mode. `mermaid.run()` marks each node
`data-processed` after rendering and won't re-render it a second time, so keep the original diagram source
around (e.g. in a `data-src` attribute) and restore it before calling `mermaid.run()` again. Resolve the
theme the same way the page itself would - an explicit `data-theme` attribute first,
`prefers-color-scheme` otherwise - and re-resolve/re-render on a
`matchMedia("(prefers-color-scheme: dark)")` change event and on a `MutationObserver` watching
`data-theme`/`class`/`style` on `<html>`. Verified working example:

```html
<div class="mermaid">
  flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do thing]
    B -->|No| D[Skip]
</div>
<button type="button" id="theme-toggle">Toggle theme</button>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.esm.min.mjs";

  const diagrams = Array.from(document.querySelectorAll(".mermaid"));
  // Mermaid replaces each node's contents with rendered SVG and marks it processed; keep the
  // original source around so a later re-render has something to start from again.
  for (const el of diagrams) el.dataset.src = el.textContent;

  function resolveTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "dark") return "dark";
    if (explicit === "light") return "default";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default";
  }

  async function renderAll() {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: resolveTheme() });
    for (const el of diagrams) {
      el.removeAttribute("data-processed");
      el.textContent = el.dataset.src;
    }
    await mermaid.run({ nodes: diagrams });
  }

  await renderAll();

  // Re-render on an OS-level scheme change and on any data-theme/class/style toggle the
  // artifact's own script makes.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
  new MutationObserver(renderAll).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
  });

  document.getElementById("theme-toggle").addEventListener("click", () => {
    document.documentElement.setAttribute("data-theme", resolveTheme() === "dark" ? "light" : "dark");
  });
</script>
```

## Seeding suggested reviewer prompts (no inkloop support needed)

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
question (the artifact's content leaving the browser) - all for a call whose output the artifact's
own author could just... write down while it's already there.

## Dev workflow

See `CONTRIBUTING.md` for local setup and the full command reference (`npm run check`,
`npm run build`, `npm run dev`) plus how to exercise the CLI end to end.

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

## Workflow for changes

1. Branch off `main`, one branch per change (`git checkout -b <short-slug>`) - see `CONTRIBUTING.md` for
   branch and PR conventions.
2. Implement, with tests. `node:test` files live under `test/`, mirroring the path of the `src/` module
   they cover (e.g. `src/shared/paths.ts` -> `test/shared/paths.test.ts`), importing from `src/` via
   relative path. Don't colocate test files inside `src/`.
3. Run `npm run check` locally before opening a PR. CI runs the same command on every PR and must pass
   before merging - see "Testing philosophy" below for what security-relevant changes need beyond that.

## Testing philosophy

- Unit test the pure modules (`shared/`) directly - no server needed.
- Integration-test the server by starting it on an ephemeral port and issuing real HTTP requests
  (`node:http` client, no supertest-style dependency).
- Anything security-relevant (Host header validation, path traversal on artifact serving, session-key
  derivation) gets an explicit negative test, not just a happy-path one.
