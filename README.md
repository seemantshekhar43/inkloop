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
agent writes .inkloop/artifact.html
  → inkloop <file>            (opens/resumes a browser session)
  → human annotates elements / text ranges, queues feedback
  → inkloop poll <file>       (agent long-polls, blocks until feedback arrives)
  → agent revises artifact.html
  → live reload, preserving scroll position and unsent draft state
  → repeat until inkloop end <file>
```

## Getting started

### Quick start

inkloop is a plain npm CLI with no server-side account or project setup, so the zero-setup path
works with any agent or no agent at all:

```
npx -y inkloop <html-file>
```

Convention: write the artifact under a project-local `.inkloop/` directory (e.g.
`.inkloop/plan-comparison.html`), rather than an arbitrary scratch location. This is not enforced by
the tool - inkloop keys the session off the file's absolute path, so any location works - but it
keeps artifacts visible in the project tree and easy to gitignore, the same pattern `.lavish/` uses
for lavish-axi. This is unrelated to inkloop's own session state (feedback, round history), which
always lives under `~/.inkloop/<hash-of-absolute-path>/` regardless of where the artifact itself is
written - see [Tech stack](#tech-stack) below.

This starts a local server, prints a session URL to open in a browser, and works identically
whether it's invoked by a human, a Claude Code skill, or any other agent shelling out to it — the
CLI and the served artifact don't care what wrote the HTML. `inkloop --help` documents the full
command set (`poll`, `end`, `stop`, `stencil`, `--reopen`).

### Claude Code

[`skills/inkloop/SKILL.md`](skills/inkloop/SKILL.md) packages the core loop above as a Claude Code
skill, so the agent recognizes when an HTML artifact is worth putting through inkloop and knows the
exact command sequence (`inkloop`, `inkloop poll --agent-reply`, `inkloop end`) without re-deriving
it from `--help` each session. This is the most complete onboarding path today; the skill file
itself is agent-agnostic prose and worth reading even when using a different client.

### GitHub Copilot, Cursor, and other agents

inkloop doesn't yet package equivalents of Claude Code's skill format for other clients. Until it
does, point the agent at [`skills/inkloop/SKILL.md`](skills/inkloop/SKILL.md)'s Workflow section
directly — most agents can be told to read a file's instructions and follow them for the rest of a
session — or paste the workflow steps into a project instructions file the agent already loads
(`.cursor/rules`, `.github/copilot-instructions.md`, etc.). The commands themselves are identical
across clients; only how the agent learns to reach for them differs.

## v1 scope

In scope: the core loop above, exactly as it is.

Deferred to v2 (deliberately, not dropped): a passive layout/QA issue inbox, and letting the reviewer
*edit* a Mermaid diagram inline as an Excalidraw-style whiteboard. Both are standout differentiators of
the closest prior art (`lavish-axi`) but also its most complex pieces — see [`docs/plan.md`](docs/plan.md)
for the reasoning.

*Rendering* a Mermaid diagram, by contrast, needs no inkloop support at all and isn't deferred to
anything — an artifact can already bring its own self-contained Mermaid script (a `.mermaid` block plus a
CDN-imported render call) and it renders identically whether opened through `inkloop <file>` or as a
standalone `.html` file. See [`docs/examples/mermaid-artifact.html`](docs/examples/mermaid-artifact.html)
for a verified working example.

## Tech stack

- **CLI / local server:** Node.js + TypeScript on `node:http` (no framework)
- **Injected browser SDK:** vanilla TypeScript, single IIFE, zero runtime dependencies
- **Transport:** plain HTTP long-poll, ~30s bounded, no WebSocket
- **Persistence:** flat JSON under `~/.inkloop/<hash-of-absolute-path>/`
- **Packaging:** single npm package (CLI, server, and SDK bundled together)

## License

MIT — see [`LICENSE`](LICENSE).
