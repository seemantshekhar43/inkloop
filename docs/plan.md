# inkloop — research &amp; plan

Reviewed and approved 2026-08-15. This is the source of truth for scope and direction until implementation
starts; update it in place rather than leaving resolved questions dangling.

## 1. Prior art deep-dive

`lavish-axi` ([kunchenguid/lavish-axi](https://github.com/kunchenguid/lavish-axi)) is the closest and most
mature comparable. It already solves the core loop end to end.

| Capability | lavish-axi | sidenote-cli (bharadwaj-pendyala) | Percy / Chromatic |
|---|---|---|---|
| **Core loop** | Open → annotate → queue → `poll` long-poll → agent revises → live reload with scroll/state preservation. File-path-keyed sessions, no accounts. | Same shape, scoped to *markdown* sites via a remark plugin that stamps source offsets; daemon resolves comments into git diffs. | CI-triggered screenshot diffing against a hosted baseline; review happens on a hosted dashboard, not local-first. |
| **Annotation granularity** | Element and text-range selection, native form controls, custom `data-lavish-action` hooks. | Text-range selection on rendered markdown blocks, pinned to a comment rail. | Bounding-box diffs on rendered screenshots — no arbitrary element/text targeting. |
| **Diagram editing** | Mermaid diagrams become editable Excalidraw whiteboards inline. | None. | None. |
| **Layout/QA detection** | Passive post-render audit (overflow, clipped text, unreachable controls) with a stateful issue inbox (open/queued/resolved/returned) and fingerprint-based de-duplication. | None — drift detection only (refuses to edit passages whose source changed since commenting). | Pixel/DOM diffing is the whole product, but it's regression-diff, not live-authoring QA. |
| **Security posture** | Loopback-only bind by default, Host-header validation against DNS rebinding, size-capped attachments, redacted `file://` paths on export. | Localhost daemon; no published rebinding/host-validation posture found. | Hosted SaaS — different trust model entirely (accounts, tokens). |
| **Local-first / no cloud in core loop** | Yes — sharing to ht-ml.app is explicit opt-in, separate command. | Yes — agent API calls are the only network dependency. | No — hosted by design. |
| **Maturity** | ~1,200 GitHub stars, published npm package, active. | 3 stars, 17 commits, early-stage (published July 2026). | Established commercial products. |

**Already solved well (don't re-invent):**
- File-path-keyed sessions with no-account, long-poll agent ergonomics
- Host-header / DNS-rebinding defense on a loopback-bound local server
- Live reload that preserves iframe scroll and in-progress annotation text
- Portable artifacts — SDK injection never leaks into the saved HTML

**Real gaps / room to differentiate:**
- Every comparable tool bolts diagram-editing and QA-detection onto the core loop — nothing offers a
  genuinely *minimal*, fast-install core loop as the whole product
- None publish a documented on-disk session schema an agent could reason about without shelling out
- sidenote-cli's drift-detection idea (refuse to resolve a comment if the underlying source moved) is good
  and worth adopting regardless of scope

## 2. Core loop, as it will work

Non-negotiable for v1 regardless of what else gets deferred.

```
Agent                    Local server (loopback)          Browser UI
  |-- write artifact.html, open session ----------------------->|
  |                       |-- launch / resume tab -------------->|
  |                       |                    human selects element or text range, writes comment
  |                       |<-- queue feedback --------------------|
  |-- poll (long-poll, blocks) ------------------------------->|
  |<-- feedback batch (once queued) -----------------------------|
  |-- revise artifact.html
  |-- poll again with --agent-reply --------------------------->|
  |                       |-- live reload, preserve scroll + unsent draft -->|
  |<-- session continues or ends ----------------------------------|
```

## 3. v1 scope — decided

| Piece | Status | Rationale |
|---|---|---|
| **Core loop** | v1 — in | Open → annotate element/text range → queue → long-poll → agent revises → live reload with state preservation. This is the entire non-negotiable spec. Effort: moderate. Table-stakes, but a smaller install footprint than lavish-axi is itself a real pitch. |
| **Layout/QA issue inbox** | v2 — noted down, not dropped | Passive render-audit + stateful issue lifecycle (open/queued/resolved/returned) is genuinely hard to get right without false positives, and lavish-axi already does it well. Effort: high (viewport matrix, fingerprinting, false-negative guards). Revisit once the core loop is proven and there's a concrete complaint it would fix. |
| **Mermaid diagram editing** | v2 — noted down, not dropped | Embedding Excalidraw, scene autosave, staleness detection on source change — a large surface for a feature most sessions won't touch. Effort: high (third-party whiteboard integration). Niche relative to the core review loop. |

Adopt regardless of scope: **drift detection**, from sidenote-cli — refuse (or flag) resolving a comment
anchored to a text range whose source has since changed, rather than silently editing the wrong thing.

## 4. Naming check — decided: `inkloop`

"Sidenote" was dropped first: an existing GitHub project
([bharadwaj-pendyala/sidenote](https://github.com/bharadwaj-pendyala/sidenote)) has an almost identical
pitch — "select a passage, comment, an AI agent resolves it into a clean git diff, local-first, in-browser"
— with an active npm package `sidenote-cli` published July 2026. Several draft/loop and mark/loop variants
were also checked and rejected before landing on `inkloop`.

| Candidate | npm (bare name) | Known collisions | Verdict |
|---|---|---|---|
| `sidenote` | Taken, dormant since 2014 (unrelated) | Direct pitch collision with an active GitHub project + its `sidenote-cli` npm package. `sidenote.app` is a $3,379 premium listing. | Drop |
| `redline` | Taken, dormant (unrelated gauge widget) | Crowded: at least 4 existing tools already use "redline" for this exact "annotate a doc, AI agent resolves it" concept (claude-redline, md-redline, and two independent redline repos). | Drop |
| `margin` / `gutter` | Both taken, dormant & unrelated | "Gutter" already means something specific in dev tools (the editor line-diff column) — conceptual overlap risks confusion even without a literal collision. | Weak |
| `draftloop` | Available | No collision, but "draft" was rejected as not fitting the annotate/markup concept. | Rejected (concept) |
| `markloop` | Taken, active (May 2026) | Yet another close-concept entrant: "local CLI and browser UI for iterative Markdown review." | Drop |
| **`inkloop`** | Available (no publish found) | No npm hits. GitHub username `inkloop` belongs to an unrelated individual (personal forks only, no tooling projects) — not a project-name conflict, but means the exact GitHub org handle may need a variant. | **Decided** |

**Not yet verified:** `inkloop.dev` / `.app` domain availability — confirm before registering anything.
Searches found no product/tool collision, which is different from a confirmed-available registration.

## 5. Proposed tech stack

Biased toward minimal install weight — this tool gets installed ambiently by agents via `npx`, so every
dependency is a tax on every session. Ships as a single npm package (CLI, server, and the injected SDK all
bundled together) rather than split packages — one install surface, one version to reason about.

| Piece | Choice | Why |
|---|---|---|
| **CLI / local server** | Node.js + TypeScript, built on the built-in `node:http` module rather than Express | Matches lavish-axi's runtime choice (broadest `npx` compatibility across agent harnesses) while cutting the one framework dependency it carries. |
| **Injected browser SDK** | Vanilla TypeScript compiled to a single IIFE, zero runtime dependencies | No UI framework — keeps the injected footprint tiny and guarantees it can never visually or behaviorally clash with whatever the artifact itself uses. |
| **Long-poll transport** | Plain HTTP long-poll, bounded to ~30s per request, CLI re-issues automatically | No WebSocket dependency — each `poll` call is a discrete agent-process invocation anyway, so a persistent socket buys nothing. |
| **Session / state persistence** | Flat JSON files under `~/.inkloop/<hash-of-absolute-path>/` | Single local user, low write concurrency — SQLite would be a dependency with no payoff at this scale. Revisit only if drift detection needs indexed lookups. |

## 6. Open questions

- License — MIT (matches lavish-axi) or something else?
- `inkloop.dev` / `.app` domain confirmation, and a GitHub org handle (exact `inkloop` username is taken by
  an unrelated individual) — resolve before registering anything.
