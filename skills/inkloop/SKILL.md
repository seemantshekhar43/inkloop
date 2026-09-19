---
name: inkloop
description: Turn a plan, comparison, table, report, diagram, code diff, or mockup into a browser surface a human can click into and annotate, using the inkloop CLI. Use whenever an HTML artifact would land better as something to point at than something to read.
argument-hint: <html-file>
---

# Inkloop

Inkloop turns an HTML artifact into a collaborative human review surface: a human opens it in a
browser, clicks an element or selects a range of text, attaches a comment, queues as many as they
want, and sends them back in one round. You long-poll for that batch, revise the artifact, and the
open tab live-reloads to show the change - no accounts, no cloud dependency, everything local.

## When to use

Use inkloop whenever you're about to hand a human an HTML artifact that's better reviewed and
iterated on interactively than in prose - a plan, comparison, diagram, table, report, code diff,
prototype, or UI mockup rendered as HTML. This isn't narrowly "reviewing HTML for bugs" - it's the same broad
goal as any visual-artifact review loop: if the content would be clearer as something the human can
point at and mark up rather than read about, build it as an HTML artifact and put it through
inkloop.

You do not need inkloop installed globally - invoke it with `npx -y inkloop <html-file>`.

## Workflow

1. Before writing any HTML, run `npx -y inkloop stencil <id>` for the content shape you're building
   (`plan`, `comparison`, `table`, `report`, `mockup`, `diagram`, or `code` - run `npx -y inkloop stencil` with
   no id to see the fit/layout/rules for each), plus `npx -y inkloop stencil loopable` every time, which
   covers loop-safety rules and a `design_baseline` visual-design floor: font stack, spacing, palette,
   component/pattern examples (including a mockup device frame and a dated timeline), a concrete
   theming mechanism (CSS custom properties plus a `data-theme` toggle), and a pinned CDN
   component-library default (Tailwind + DaisyUI) - to fall back on only once you've checked for a
   user-specified look, a project design.md/style guide, or the subject's own existing design system
   first, and to state explicitly which of those you ended up using.
2. Write the artifact as a `.html` file under `.inkloop/` in the current project (e.g.
   `.inkloop/plan-comparison.html`), creating the directory if needed. This is a convention, not a
   requirement enforced by the tool - inkloop keys the session off the file's absolute path, so any
   location works - but keeping it in `.inkloop/` makes it visible and easy to gitignore alongside
   the rest of the project, rather than scattered in a scratch dir. Prefer resuming/revising an
   existing artifact under `.inkloop/` over writing a new one for the same review thread.
3. Run `npx -y inkloop <html-file>` to open or resume a review session. It starts a local server and
   prints a `http://127.0.0.1:<port>/session/<hash>` URL - share that with the human (or open it
   yourself if you're driving the browser too).
4. Run `npx -y inkloop poll <html-file>` to long-poll for the human's queued annotations. This
   blocks, retrying automatically on each empty result, until feedback actually arrives - leave it
   running rather than working around it. Progress goes to stderr; the only thing written to stdout
   is the final payload, in TOON (toonformat.dev) - a compact table for `items` plus one
   `key: value` line per remaining field, e.g.:
   ```
   items[2]{id,target_kind,target_selector,...,comment,createdAt,...}:
     a1,element,h1,...,"make the heading bigger",2026-08-23T10:00:01.000Z,...
     a2,general,null,...,"looks great overall",2026-08-23T10:00:00.000Z,...
   next_step: Revise the artifact based on this feedback, then run `inkloop poll <file> ...`
   ```
   `next_step` spells out the literal next command - trust it over re-deriving the loop from
   memory, especially once a session has ended (`ended`/`endedBy` ride along too in that case, and
   `items` is `[]`). `inkloop end <html-file>` (step 7) prints the same TOON style, just without an
   `items` table.
   On rounds after the first, pass `--agent-reply "<one-line summary of what changed>"` so the
   round-history panel shows your reply before the poll blocks again.
5. Revise the `.html` file in place based on the feedback. No need to re-run `inkloop <file>` - the
   open browser tab live-reloads on its own, preserving scroll position and any unsent draft.
6. Repeat steps 4-5 until the review is done.
7. Run `npx -y inkloop end <html-file>` to close out the session from your side.

## Session & state model

- Sessions are keyed off the artifact's absolute file path (hashed to 16 hex chars) - no accounts,
  no server-side project setup.
- Session bookkeeping (feedback, round history, status) lives under `~/.inkloop/<hash>/` - this is
  separate from the artifact file itself (which belongs in the project's own `.inkloop/`, per step 2
  above) and from any git repo. Nothing leaves the machine either way.
- If the human ends the session from the browser, a later plain `inkloop <file>` refuses to reopen
  it. Only pass `--reopen` when the human actually asks for further review - don't reopen a
  human-ended session uninvited.
- `inkloop end <file>` (this side, agent-initiated) ends with status `agent-ended`, which a later
  `inkloop <file>` reopens freely without `--reopen` - the two ends aren't symmetric.

## Feedback shape

Each row `inkloop poll`'s `items` table hands back has (columns flattened for the table - `target_*`
below is `target.*` in the underlying data model, not nested in the TOON output):

- `target_kind`: `"element"`, `"text-range"`, or `"general"` (a free-text note not tied to anything
  specific)
- `target_selector` and, for text ranges, `target_quote` - what was picked (`null` when not
  applicable to that row's kind)
- `comment`: the human's note
- `drifted`: `true` if a `text-range` annotation's anchored text has since changed underneath it
  (e.g. you already edited that passage in an earlier round) - treat this as needing re-anchoring
  against the current content, not as an ordinary comment to resolve at face value; `null` when not
  drifted

## Rules

- `.html` files only - `inkloop <file>` refuses any other extension.
- The review chrome is injected at serve time only. Opening the saved `.html` file directly, with no
  inkloop server running, renders identically - never strip anything out of the artifact for it to
  work standalone.
- Keep `inkloop poll` in the foreground by default. A background poll is fine only through a
  harness-native tracked background-job facility with a guaranteed wake/notify path back to you -
  never a bare shell `&`, `nohup`, or a detached process with no callback, since a poll that never
  reports back is a poll that silently loses the loop.
- If an `inkloop poll ...` follow-up command is printed to you, run it the same way
  (`npx -y inkloop poll ...`), not as a bare `inkloop ...`.

## Reference

- `npx -y inkloop stencil` - content-guidance and visual-design-baseline reference (see workflow step 1)
- `README.md` - core loop, tech stack
