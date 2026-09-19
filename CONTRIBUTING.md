# Contributing to inkloop

Thanks for considering a contribution. This doc covers local setup, the commands you'll run, and how to
exercise the CLI end to end to verify a change. `AGENTS.md` covers the standing rules specific to working
in this repo (security posture, dependency policy, and the rest of the non-negotiables) - worth a skim
too, even if it's written with an AI coding agent as the primary reader as well as a human one.

## Local setup

```
npm install
```

No further setup - no accounts, no server-side project, no environment variables required for local dev.

## Commands

```
npm run check   # lint + typecheck + test - the single local gate, run before every commit
npm run build   # compiles src/ to dist/
npm run dev     # runs the CLI from source via ts-node/tsx for manual testing
npm run test    # test only
npm run lint    # lint only
```

Run `npm run check` before considering any change done.

## Exercising the CLI end to end

The fastest way to verify a change against the real loop, rather than just unit tests:

```
echo '<html><body><h1>hello</h1></body></html>' > /tmp/example.html
npm run dev -- /tmp/example.html          # opens/resumes a session, prints a URL to open
```

Open the printed URL in a browser, click an element or select some text, write a comment, and queue it.
Then, in another terminal:

```
npm run dev -- poll /tmp/example.html     # blocks until the feedback you queued arrives
```

Revise `/tmp/example.html` and save - the open tab live-reloads, preserving scroll position and any
unsent draft. Repeat, then close out the session:

```
npm run dev -- end /tmp/example.html
```

This is the same loop a real agent runs (`inkloop <file>` → `inkloop poll` → revise → repeat →
`inkloop end`), just invoked through `npm run dev --` instead of an installed `inkloop` binary.

## Directory layout

```
src/
  cli/      entry point, argument parsing, one file per subcommand
  server/   node:http server, routing, session HTTP handlers
  sdk/      injected browser SDK (compiled to a single IIFE, zero deps)
  shared/   types and pure logic shared across cli/server/sdk (session store, fingerprinting, etc.)
test/       node:test files, mirroring src/'s directory structure 1:1 (test/server/foo.test.ts
            covers src/server/foo.ts). src/ is production-only; keep it that way.
```

`node:test` files live under `test/`, mirroring the path of the `src/` module they cover (e.g.
`src/shared/paths.ts` -> `test/shared/paths.test.ts`), importing from `src/` via relative path. Don't
colocate test files inside `src/`.

Testing philosophy:
- Unit test the pure modules (`shared/`) directly - no server needed.
- Integration-test the server by starting it on an ephemeral port and issuing real HTTP requests
  (`node:http` client, no supertest-style dependency).
- Anything security-relevant (Host header validation, path traversal on artifact serving, session-key
  derivation) gets an explicit negative test, not just a happy-path one.

## Branch and PR conventions

- Branch off `main`, one branch per change (`git checkout -b <short-slug>`).
- Keep the diff scoped to one change; a PR description should say what changed and why, not just what
  files moved.
- `npm run check` must pass before opening a PR.
- Reference any issue the PR closes with a `Closes #<n>` line in the PR body.

## Releasing

CI (`.github/workflows/ci.yml`) runs `npm run check` and `npm run build` on every push and PR against
`main`. Publishing to npm is tag-triggered, not manual:

1. Bump `version` in `package.json` (semver) and commit it to `main`.
2. Tag the commit `vX.Y.Z` matching that version exactly (`git tag vX.Y.Z && git push origin vX.Y.Z`).
3. Pushing the tag runs `.github/workflows/release.yml`, which re-runs `npm run check`, verifies the tag
   matches `package.json`'s version, builds `dist/`, and runs `npm publish --provenance` using the
   repo's `NPM_TOKEN` secret.

`prepublishOnly` (in `package.json`) also runs `npm run check && npm run build` as a local safeguard, so
a manual `npm publish` can't ship a stale or missing `dist/` either.

## What AGENTS.md is for

`AGENTS.md` exists alongside this file for a different reason: it's the standing-instructions doc for an
AI coding agent working in this repo session to session - security posture, the zero-bloat dependency
policy, and other non-negotiables that don't need restating here since they apply the same way regardless
of who (or what) is making the change. Worth reading once if you're contributing by hand too, so you know
the same constraints an agent working in this repo is held to.
