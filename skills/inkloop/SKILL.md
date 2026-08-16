---
name: inkloop
description: Turn an HTML artifact - plan, comparison, diagram, table, report, prototype, UI mockup - into a browser review surface a human can annotate and reply to, using the inkloop CLI.
argument-hint: <html-file>
metadata:
  hermes:
    tags: [html, review, artifacts, annotation]
    category: productivity
---

# Inkloop

Inkloop turns an HTML artifact into a collaborative human review surface: a human opens it in a
browser, clicks an element or selects a range of text, attaches a comment, queues as many as they
want, and sends them back in one round. You long-poll for that batch, revise the artifact, and the
open tab live-reloads to show the change - no accounts, no cloud dependency, everything local.

## When to use

Use inkloop whenever you're about to hand a human an HTML artifact that's better reviewed and
iterated on interactively than in prose - a plan, comparison, diagram, table, report, prototype, or
UI mockup rendered as HTML. This isn't narrowly "reviewing HTML for bugs" - it's the same broad
goal as any visual-artifact review loop: if the content would be clearer as something the human can
point at and mark up rather than read about, build it as an HTML artifact and put it through
inkloop.

You do not need inkloop installed globally - invoke it with `npx -y inkloop <html-file>`.

## Workflow

1. Write the artifact as a `.html` file. Location doesn't matter - inkloop keys the session off the
   file's absolute path, not a fixed directory.
2. Run `npx -y inkloop <html-file>` to open or resume a review session. It starts a local server and
   prints a `http://127.0.0.1:<port>/session/<hash>` URL - share that with the human (or open it
   yourself if you're driving the browser too).
3. Run `npx -y inkloop poll <html-file>` to long-poll for the human's queued annotations. This
   blocks, retrying automatically on each empty result, until feedback actually arrives - leave it
   running rather than working around it. Progress goes to stderr; the only thing written to stdout
   is the final payload, as JSON: `{ items, next_step, ... }`. `next_step` spells out the literal
   next command - trust it over re-deriving the loop from memory, especially once a session has
   ended (`ended`/`endedBy` ride along too in that case).
   On rounds after the first, pass `--agent-reply "<one-line summary of what changed>"` so the
   round-history panel shows your reply before the poll blocks again.
4. Revise the `.html` file in place based on the feedback. No need to re-run `inkloop <file>` - the
   open browser tab live-reloads on its own, preserving scroll position and any unsent draft.
5. Repeat steps 3-4 until the review is done.
6. Run `npx -y inkloop end <html-file>` to close out the session from your side.

## Session & state model

- Sessions are keyed off the artifact's absolute file path (hashed to 16 hex chars) - no accounts,
  no server-side project setup.
- All state is local, under `~/.inkloop/<hash>/` - nothing leaves the machine.
- If the human ends the session from the browser, a later plain `inkloop <file>` refuses to reopen
  it. Only pass `--reopen` when the human actually asks for further review - don't reopen a
  human-ended session uninvited.
- `inkloop end <file>` (this side, agent-initiated) ends with status `agent-ended`, which a later
  `inkloop <file>` reopens freely without `--reopen` - the two ends aren't symmetric.

## Feedback shape

Each item `inkloop poll` hands back has:

- `target.kind`: `"element"`, `"text-range"`, or `"general"` (a free-text note not tied to anything
  specific)
- `target.selector` and, for text ranges, `target.quote` - what was picked
- `comment`: the human's note
- `drifted`: `true` if a `text-range` annotation's anchored text has since changed underneath it
  (e.g. you already edited that passage in an earlier round) - treat this as needing re-anchoring
  against the current content, not as an ordinary comment to resolve at face value

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

- `README.md` - core loop, tech stack
- `docs/plan.md` - prior-art study, v1 scope, naming rationale
