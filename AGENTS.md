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
- **Portability of the core loop over new features.** If a change would complicate the open → annotate →
  queue → poll → revise → reload loop to make room for something else, it belongs in a v2 issue, not v1.
  Layout/QA detection and Mermaid editing are explicitly deferred — see `docs/plan.md` §3.

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
```

## GitHub issue workflow (follow this for every change)

1. **Every unit of work is a tracked issue**, labeled `v1` for the current milestone. Check
   `gh-axi issue list --label v1` for the backlog before starting anything new; file a new issue for
   anything not already covered rather than doing untracked work.
2. **Branch per issue**: `git checkout -b issue-<n>-<short-slug>` off `main`.
3. Implement, with tests. `node:test` files live next to the code they cover as `*.test.ts`.
4. **Run `npm run check` locally before considering the issue done.**
5. **Gate with the `no-mistakes` skill before merging** — it runs review, tests, lint, docs, and drives the
   push/PR/CI flow. Do not hand-merge around it. This is a hard requirement for this repo, not an optional
   extra pass: security bugs in an unauthenticated local HTTP server are exactly the class of mistake it's
   designed to catch.
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
