# inkloop

A local-first CLI for human-AI collaboration on rendered HTML artifacts. An agent writes an HTML artifact,
a human opens it in a browser UI to annotate specific elements or text ranges, feedback queues up, and the
agent long-polls for it and iterates — no accounts, no cloud dependency in the core loop.

**Status: `inkloop <file>` opens or resumes a session and serves the artifact (issue #4), with the injected
browser SDK (issue #5) and review UI shell (issue #6) driving annotation and queuing, `inkloop poll <file>`
long-polling for feedback (issue #7), live reload with scroll/draft preservation (issue #8),
`inkloop end <file>` plus the browser's "End session" button closing out a session (issue #9), and drift
detection flagging text-range annotations whose anchored text has since changed (issue #10).** See
[`docs/plan.md`](docs/plan.md) for the full prior-art study, v1 scope decision, naming rationale, and tech
stack proposal.

## Why

Reviewing agent-generated HTML has largely fallen back to screenshots and prose descriptions. inkloop
restores direct interaction — click the thing that's wrong, say what's wrong with it — as the feedback
mechanism, keyed off the file path with no server-side state beyond the local machine.

## Core loop (v1)

```
agent writes artifact.html
  → inkloop <file>            (opens/resumes a browser session)
  → human annotates elements / text ranges, queues feedback
  → inkloop poll <file>       (agent long-polls, blocks until feedback arrives)
  → agent revises artifact.html
  → live reload, preserving scroll position and unsent draft state
  → repeat until inkloop end <file>
```

## Using inkloop as an agent skill

[`skills/inkloop/SKILL.md`](skills/inkloop/SKILL.md) packages the core loop above as a Claude Code
skill, so an agent recognizes when an HTML artifact is worth putting through inkloop and knows the
exact command sequence (`inkloop`, `inkloop poll --agent-reply`, `inkloop end`) without re-deriving
it from `--help` each session.

## v1 scope

In scope: the core loop above, exactly as it is.

Deferred to v2 (deliberately, not dropped): a passive layout/QA issue inbox, and inline Mermaid diagram
editing. Both are the standout differentiators of the closest prior art (`lavish-axi`) but also its most
complex pieces — see [`docs/plan.md`](docs/plan.md) for the reasoning.

## Tech stack

- **CLI / local server:** Node.js + TypeScript on `node:http` (no framework)
- **Injected browser SDK:** vanilla TypeScript, single IIFE, zero runtime dependencies
- **Transport:** plain HTTP long-poll, ~30s bounded, no WebSocket
- **Persistence:** flat JSON under `~/.inkloop/<hash-of-absolute-path>/`
- **Packaging:** single npm package (CLI, server, and SDK bundled together)

## License

MIT — see [`LICENSE`](LICENSE).
