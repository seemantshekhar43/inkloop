/**
 * The review UI shell (issue #6, polished in #18): the browser-side page a human actually uses,
 * hosting the artifact iframe plus the annotation composer and queue thread around it.
 *
 * Issue #43 re-evaluated the original bottom-dock layout (below) against a fixed-width right-side
 * panel: the round-history transcript grows unboundedly, and a bottom dock competing for
 * *vertical* space with the artifact got worse the longer a session ran, whereas a side panel
 * trades a fixed slice of horizontal space (usually more abundant on a reviewer's monitor) for
 * giving the artifact the full viewport height back. The AGENTS.md "visual novelty" non-negotiable
 * that ruled out a sidebar the first time around is still respected on its own terms, not
 * abandoned: this isn't lavish-axi's chat-bubble "Conversation" sidebar reskinned, it's the same
 * round-grouped transcript shape and pill-tag treatment from the bottom-dock version, just
 * reflowed into a vertical column instead of a horizontal strip. Below ~900px width — where the
 * horizontal space a side panel needs is the scarcer resource, not the vertical space it was
 * saving — a media query alone (no JS, no user preference to maintain) folds the panel back into
 * a bottom dock, so the original layout's reasoning still applies exactly where it was strongest.
 *
 * This page and the injected SDK (src/sdk/index.ts, running inside the iframe) talk over
 * postMessage only, restricted to same-origin on both ends — see the SDK's own header comment
 * for the message shapes this shell sends and listens for.
 *
 * No framework, no bundler: the inline <script> below is plain ES5-ish JavaScript executed
 * as-is by the browser (this file itself is TypeScript, but the template literal's contents are
 * not compiled) — matches the injected SDK's zero-build-step constraint for anything that ships
 * to a browser without going through tsc first.
 */
export function renderReviewShell(hash: string): string {
  // hash is validated upstream by the server's route regex ([0-9a-f]{16}), so it's safe to
  // interpolate directly here — same reasoning as the artifact/feedback route handlers.
  // Issue #79: the standard "toggle side panel" glyph (a rounded rect standing in for the whole
  // shell, one section shaded to mark the panel) — shared by both the in-panel collapse button
  // and the edge handle that replaces it once collapsed, since they're the same concept from two
  // different states, not two different icons.
  const dockToggleIcon = `<svg class="dock-toggle-icon" width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.3"/><rect x="10.6" y="3.4" width="3.1" height="9.2" rx="0.6" fill="currentColor"/></svg>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0b0f">
<title>inkloop review</title>
<style>
  :root {
    /* This shell only ever ships a dark palette (no light-mode variant to switch to) - telling
       the browser that up front means its own UI (form-control chrome, scrollbars on platforms
       that don't respect the custom ::-webkit-scrollbar-* rules above) matches instead of
       defaulting to a light theme that would clash. */
    color-scheme: dark;
    --ink-bg: #0b0b0f;
    --ink-bg-glow: radial-gradient(1200px 480px at 12% -10%, rgba(111, 91, 255, 0.16), transparent 60%),
      radial-gradient(900px 420px at 100% 0%, rgba(232, 165, 60, 0.06), transparent 55%);
    --ink-panel: #141419;
    --ink-panel-raised: #191921;
    --ink-border: #242430;
    --ink-border-soft: #1c1c24;
    --ink-text: #e9e9ee;
    --ink-dim: #8f8fa3;
    --ink-accent: #6f5bff;
    --ink-accent-2: #9d8fff;
    --ink-accent-soft: rgba(111, 91, 255, 0.12);
    --ink-accent-text: #ffffff;
    /* Issue #44: --ink-accent itself is only ~3.6:1 against the tinted pill/history-item
       backgrounds it sits on as text (the ELEMENT/SELECTION target labels) — under the 4.5:1
       WCAG minimum for text that size. A lighter tint of the same hue clears it comfortably
       (6:1+) without touching --ink-accent's own uses as a background/border color, which were
       already fine. */
    --ink-accent-label: #9d8fff;
    /* Second accent (issue #21): amber, reserved for anything agent-authored (the "Agent
       revised" entries in the round-history panel) so it never reads as ambiguous with the
       violet used for human annotations everywhere else. */
    --ink-agent: #e8a53c;
    --ink-agent-soft: rgba(232, 165, 60, 0.12);
    --ink-success: #35c98c;
    --ink-error: #ff6b6b;
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    /* Issue #42: a deliberate type scale instead of ad hoc px values scattered per rule — the
       ratio (~1.15) is tight on purpose, since this is a dense review tool, not a marketing page,
       but every size below is now a step on the same scale rather than a one-off guess. */
    --text-2xs: 10px;
    --text-xs: 11px;
    --text-sm: 12px;
    --text-base: 13px;
    --text-md: 15px;
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.24);
    --shadow-md: 0 6px 20px rgba(0, 0, 0, 0.35);
    --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.5);
    --shadow-glow: 0 0 0 1px rgba(111, 91, 255, 0.28), 0 4px 16px rgba(111, 91, 255, 0.18);
  }
  * { box-sizing: border-box; }
  /* The bottom-dock breakpoint (#43) makes every button here a touch target on mobile: skip the
     ~300ms tap delay browsers otherwise reserve for double-tap-to-zoom detection, and replace the
     default grey tap-highlight flash with something that matches this shell's own :active states
     (transform: scale) instead of clashing with them. */
  button { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0; height: 100%;
    /* Matches axi.md's own mono stack (kunchenguid-design-system's --font-mono) so the two share
       a font identity where a reviewer is likely to have both open — JetBrains Mono/Fira Code
       first if installed locally, falling through to the same system-monospace stack as before
       otherwise. No webfont load: inkloop stays local-first/no-CDN (see README), so this is a
       font-family preference only, never a network fetch. */
    font-family: "JetBrains Mono", "Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--text-base);
    /* Issue #42: a faint two-point radial glow over the flat base color — reads as a considered
       surface rather than default-browser black, without introducing any texture heavy enough to
       compete with the artifact iframe it sits behind. */
    background: var(--ink-bg-glow), var(--ink-bg);
    background-attachment: fixed;
    color: var(--ink-text);
  }
  /* Issue #42: a themed scrollbar everywhere the default browser chrome would otherwise show
     through (history panel, thread, textarea resize) — Firefox via scrollbar-color, WebKit via
     the ::-webkit-scrollbar-* pseudo-elements below. */
  * { scrollbar-width: thin; scrollbar-color: var(--ink-border) transparent; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--ink-border); border-radius: 999px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--ink-dim); }
  body { display: flex; flex-direction: column; }
  header {
    flex: 0 0 auto; display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--ink-border); background: var(--ink-panel);
    box-shadow: var(--shadow-sm);
    position: relative; z-index: 1;
  }
  .wordmark {
    font-weight: 700; font-size: var(--text-md); letter-spacing: 0.01em;
    background: linear-gradient(120deg, var(--ink-text) 35%, var(--ink-accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .wordmark::before { content: "⌁ "; color: var(--ink-accent); -webkit-text-fill-color: var(--ink-accent); }
  .session-path {
    flex: 1; color: var(--ink-dim); font-size: var(--text-sm);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  button.pick {
    appearance: none; border: 1px solid var(--ink-border); background: var(--ink-panel-raised);
    color: var(--ink-text); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
    font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: var(--space-2);
    transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out),
      box-shadow 0.15s var(--ease-out), transform 0.1s var(--ease-out);
  }
  button.pick:hover { border-color: var(--ink-accent); }
  button.pick:active { transform: scale(0.97); }
  button.pick.active {
    background: var(--ink-accent); border-color: var(--ink-accent); color: var(--ink-accent-text);
    box-shadow: var(--shadow-glow);
  }
  /* Issue #27: a bare border/background change read as too subtle to register as an on/off
     toggle at a glance — a dot indicator (hollow when off, solid-filled when on, matching the
     familiar "recording" convention) plus a label that swaps to an explicit call-to-cancel make
     the state unambiguous either way. */
  .pick-dot {
    width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto;
    border: 1.5px solid var(--ink-dim); background: transparent;
    transition: background-color 0.12s ease, border-color 0.12s ease;
  }
  button.pick.active .pick-dot { background: var(--ink-accent-text); border-color: var(--ink-accent-text); }
  button.end-session {
    appearance: none; border: 1px solid var(--ink-border); background: transparent;
    color: var(--ink-error); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
    font: inherit; cursor: pointer;
    transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out), transform 0.1s var(--ease-out);
  }
  button.end-session:hover { border-color: var(--ink-error); background: rgba(255, 107, 107, 0.1); }
  button.end-session:active { transform: scale(0.97); }
  button.end-session:disabled { opacity: 0.4; cursor: default; transform: none; }
  .ended-banner {
    flex: 0 0 auto; display: none; align-items: center;
    padding: var(--space-2) var(--space-4); font-size: var(--text-sm); color: var(--ink-accent-text);
    background: var(--ink-error); border-bottom: 1px solid var(--ink-border);
    animation: bannerIn 0.2s var(--ease-out);
  }
  .ended-banner.visible { display: flex; }
  .tab-banner {
    flex: 0 0 auto; display: none; align-items: center;
    padding: var(--space-2) var(--space-4); font-size: var(--text-sm); color: var(--ink-agent);
    background: var(--ink-agent-soft); border-bottom: 1px solid var(--ink-border);
    animation: bannerIn 0.2s var(--ease-out);
  }
  .tab-banner.visible { display: flex; }
  @keyframes bannerIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  /* Issue #61: shown as a one-time reminder when Sidenote turns on, not for as long as picking
     mode stays active — the toggle button itself (active/pressed state, dot lit, "Stop Sidenote"
     label) is the persistent indicator, so the banner only needs to teach the mechanism once per
     activation, then get out of the way. .fading drives the opacity transition below the
     JS-controlled auto-hide timer, so the banner's departure reads as an intentional dismissal
     rather than a jump-cut. */
  .picking-hint {
    flex: 0 0 auto; display: none; align-items: center;
    padding: var(--space-2) var(--space-4); font-size: var(--text-sm); color: var(--ink-accent-text);
    background: var(--ink-accent); border-bottom: 1px solid var(--ink-border);
    opacity: 1; transition: opacity 0.3s ease; animation: bannerIn 0.2s var(--ease-out);
  }
  .picking-hint.visible { display: flex; }
  .picking-hint.fading { opacity: 0; }
  .content { flex: 1 1 auto; display: flex; flex-direction: row; min-height: 0; position: relative; }
  main { flex: 1 1 auto; position: relative; min-height: 0; }
  iframe { border: 0; width: 100%; height: 100%; display: block; background: #fff; }
  /* Issue #43: a fixed-width right-side panel instead of the full-width bottom dock — see the
     file header comment for the reasoning and the <900px fallback below. */
  aside#dock {
    flex: 0 0 340px; width: 340px; display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--ink-border); background: var(--ink-panel);
    box-shadow: -12px 0 32px -12px rgba(0, 0, 0, 0.4);
    position: relative; z-index: 1;
  }
  /* Issue #79: collapsing the dock hands its full 340px back to the artifact iframe — display:
     none rather than an animated width collapse, since the panel's own contents (history list,
     composer) have no useful mid-collapse state to animate through, and this stays correct
     unmodified under the <900px bottom-drawer layout below (that breakpoint only changes the
     dock's own flex/width, not this rule). */
  body.dock-collapsed aside#dock { display: none; }
  /* Issue #79: the dock only ever needs one toggle visible at a time — a "hide" control living
     inside the panel itself (top-right of its header row, next to the round count) while it's
     open, and a "show" handle at the viewport's right edge once it's gone (positioned relative to
     .content, not the aside, or it would vanish along with everything else display:none hides).
     Neither button changes what it does or how it looks; only which one is present changes. */
  .dock-handle {
    appearance: none; border: 1px solid var(--ink-border); border-right: 0;
    background: var(--ink-panel-raised); color: var(--ink-dim);
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    display: none; align-items: center; justify-content: center; cursor: pointer;
    position: absolute; z-index: 2; top: 50%; right: 0; width: 22px; height: 60px;
    transform: translateY(-50%);
    transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out),
      color 0.15s var(--ease-out);
  }
  .dock-handle:hover { color: var(--ink-text); border-color: var(--ink-accent); }
  .dock-handle:active { transform: translateY(-50%) scale(0.93); }
  body.dock-collapsed .dock-handle { display: flex; }
  .dock-toggle-icon { display: block; }
  /* The edge handle only ever means "bring the panel back" — a plain directional arrow reads
     faster there than the panel glyph the in-panel collapse button uses, especially at this
     handle's narrow width. Rotates 90° under the <900px bottom-drawer layout below, where "back"
     means "up" instead of "left". */
  .dock-handle-arrow { font-size: var(--text-md); line-height: 1; display: inline-block; }
  .dock-header-row {
    flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-2); padding: var(--space-3) var(--space-4) var(--space-2);
  }
  .dock-section-label {
    font-size: var(--text-xs); color: var(--ink-dim);
    text-transform: uppercase; letter-spacing: 0.06em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .dock-collapse-btn {
    appearance: none; border: 1px solid var(--ink-border); background: transparent;
    color: var(--ink-dim); border-radius: var(--radius-sm); cursor: pointer; flex: 0 0 auto;
    width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
    transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out),
      color 0.15s var(--ease-out), transform 0.1s var(--ease-out);
  }
  .dock-collapse-btn:hover { color: var(--ink-text); border-color: var(--ink-accent); }
  .dock-collapse-btn:active { transform: scale(0.93); }
  .history-panel {
    flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--space-3);
    overflow-y: auto; min-height: 80px; padding: 0 var(--space-4) var(--space-3);
    /* Below ~900px the dock becomes a bottom drawer (see the media query further down) sitting
       right above the artifact iframe — without this, scrolling past either end of the history
       list chains into scrolling the page/iframe behind it. */
    overscroll-behavior: contain;
  }
  .history-empty { color: var(--ink-dim); font-size: var(--text-sm); }
  .history-round { display: flex; flex-direction: column; gap: var(--space-2); }
  /* Issue #63: the optimistic round painted in immediately on Send, before the server has
     confirmed it — same markup as a real round, just visibly provisional until it does. */
  .history-round.pending { opacity: 0.6; }
  .history-round-label {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
    font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-dim);
  }
  /* Issue #76: a reviewer sending feedback had no way to tell "the agent hasn't looked at this
     yet" from "the agent has it and is working" from "stuck" — the only prior signal was the
     artifact silently live-reloading once a revision landed. Driven entirely off data the server
     already tracked (FeedbackItem.deliveredAt, set the moment an inkloop poll call claims a
     round, and the round's agent reply, if any) — no new endpoint needed, see roundStatus() below. */
  .history-round-status {
    display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
    font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: 0.04em;
  }
  .history-round-status::before {
    content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto;
  }
  .history-round-status.status-queued { color: var(--ink-dim); }
  .history-round-status.status-sending { color: var(--ink-dim); }
  .history-round-status.status-delivered { color: var(--ink-agent); }
  .history-round-status.status-revised { color: var(--ink-success); }
  /* The "agent has it" state has no natural end signal (there's no "agent is done thinking"
     event) — pulsing the dot instead of leaving it static is what actually answers the reviewer's
     "is this stuck?" question at a glance, without fabricating a fake progress bar. */
  .history-round-status.status-delivered::before { animation: statusPulse 1.6s ease-in-out infinite; }
  @keyframes statusPulse {
    0%, 100% { opacity: 1; } 50% { opacity: 0.35; }
  }
  /* A moving gradient sweep across the working verb itself — reads as "still going" the same way
     a chat app's "thinking…" shimmer does, more attention-grabbing than the pulsing dot alone
     without going as far as a spinner (which would overstate how much progress info is actually
     available — see roundStatus()'s docstring on why there's no real percent-done here). */
  .history-round-status.status-delivered .status-text {
    background: linear-gradient(90deg, var(--ink-agent) 0%, #fbe4b0 50%, var(--ink-agent) 100%);
    background-size: 200% 100%; -webkit-background-clip: text; background-clip: text;
    color: transparent; -webkit-text-fill-color: transparent;
    animation: statusShimmer 1.8s linear infinite;
  }
  @keyframes statusShimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }
  .history-items { display: flex; flex-direction: column; gap: var(--space-1); }
  .history-item {
    border-left: 2px solid var(--ink-accent); background: var(--ink-accent-soft);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0; padding: var(--space-2);
    font-size: var(--text-sm); line-height: 1.45; box-shadow: var(--shadow-sm);
  }
  .history-item-target {
    color: var(--ink-accent-label); font-size: var(--text-2xs); text-transform: uppercase;
    letter-spacing: 0.06em; margin-right: var(--space-1);
  }
  .history-item-comment { color: var(--ink-text); word-break: break-word; }
  .history-item.drifted { border-left-color: var(--ink-error); background: rgba(255, 107, 107, 0.1); }
  .history-item-drift-note {
    display: block; color: var(--ink-error); font-size: var(--text-2xs); text-transform: uppercase;
    letter-spacing: 0.06em; margin-top: var(--space-1);
  }
  .history-reply {
    border-left: 2px solid var(--ink-agent); background: var(--ink-agent-soft);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0; padding: var(--space-2);
    box-shadow: var(--shadow-sm);
  }
  .history-reply-label {
    color: var(--ink-agent); font-size: var(--text-2xs); text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: var(--space-1);
  }
  .history-reply-message { color: var(--ink-text); font-size: var(--text-sm); line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  /* The queued-but-unsent draft thread: a horizontally-scrolling strip in the old bottom dock,
     now a vertical stack — the side panel's column is narrower than most drafts' natural width,
     so stacking reads better than a second internal scrollbar running the other way. */
  .thread {
    flex: 0 1 auto; display: flex; flex-direction: column; gap: var(--space-2);
    overflow-y: auto; max-height: 40%; min-height: 0;
    padding: var(--space-3) var(--space-4); border-top: 1px solid var(--ink-border);
  }
  .thread-empty { color: var(--ink-dim); font-size: var(--text-sm); padding: var(--space-1) 0; }
  .thread-empty::before { content: "› "; color: var(--ink-accent); }
  /* Issue #73: contextual starter prompts derived from the loaded artifact, offered instead of a
     blank composer on first open — hidden entirely once the session has a sent round (see
     renderSuggestions' hasHistory check), so returning reviewers with real history never see
     stale hints crowd the panel. */
  .suggestions {
    display: none; flex-direction: column; gap: var(--space-2);
    padding: var(--space-3) var(--space-4) 0;
  }
  .suggestions.visible { display: flex; }
  .suggestions-label {
    font-size: var(--text-xs); color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.06em;
  }
  .suggestion-chip {
    position: relative; border: 1px solid var(--ink-border); border-radius: var(--radius-md);
    background: var(--ink-panel-raised); color: var(--ink-text);
    padding: var(--space-2) 26px var(--space-2) var(--space-3);
    font-size: var(--text-sm); line-height: 1.4; cursor: pointer;
    transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
  }
  .suggestion-chip:hover, .suggestion-chip:focus-visible {
    border-color: var(--ink-accent); box-shadow: var(--shadow-glow);
  }
  .suggestion-chip-remove {
    position: absolute; top: 4px; right: 4px; width: 18px; height: 18px;
    appearance: none; border: 0; border-radius: var(--radius-sm); background: transparent;
    color: var(--ink-dim); font: inherit; line-height: 1; cursor: pointer;
  }
  .suggestion-chip-remove:hover { background: var(--ink-border); color: var(--ink-text); }
  .pill {
    position: relative; border: 1px solid var(--ink-border); border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3); padding-right: 26px;
    background: var(--ink-panel-raised); font-size: var(--text-sm); line-height: 1.45;
    box-shadow: var(--shadow-sm);
    transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out), transform 0.15s var(--ease-out);
    animation: pillIn 0.18s var(--ease-out);
  }
  .pill:hover { border-color: var(--ink-accent); box-shadow: var(--shadow-glow); transform: translateY(-1px); }
  @keyframes pillIn {
    from { opacity: 0; transform: translateY(4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .pill .pill-target {
    color: var(--ink-accent-label); font-size: var(--text-2xs); text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: var(--space-1);
  }
  .pill .pill-comment { color: var(--ink-text); white-space: normal; word-break: break-word; }
  .pill-remove {
    position: absolute; top: 4px; right: 4px; width: 18px; height: 18px;
    appearance: none; border: 0; border-radius: var(--radius-sm); background: transparent;
    color: var(--ink-dim); font: inherit; line-height: 1; cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .pill-remove:hover { background: var(--ink-border); color: var(--ink-text); }
  /* Stacked, not the old side-by-side row — 340px isn't wide enough for a textarea and a
     same-line Send button both to read comfortably. */
  .composer-row {
    flex: 0 0 auto; display: flex; flex-direction: column; gap: var(--space-2);
    padding: var(--space-3) var(--space-4); border-top: 1px solid var(--ink-border);
  }
  .composer-row textarea {
    /* min-height fits ~4 visible lines, rather than the single-line-ish 36px it used to default
       to - a reviewer writing more than a short note shouldn't immediately have to fight the
       resize handle just to see what they've typed. (92px rendered closer to 5 lines in practice
       than the line-height arithmetic suggested - tuned down from there instead.) */
    resize: vertical; min-height: 74px; max-height: 220px; line-height: 1.4;
    background: #101014; color: var(--ink-text); border: 1px solid var(--ink-border);
    border-radius: var(--radius-sm); padding: var(--space-2); font: inherit;
    transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
  }
  .composer-row textarea:focus {
    outline: none; border-color: var(--ink-accent); box-shadow: var(--shadow-glow);
  }
  .composer-row textarea:disabled { opacity: 0.4; cursor: default; }
  /* Issue #44: pinned explicitly rather than left to the browser's own placeholder styling —
     Chrome/Firefox/Safari each dim placeholder text by a different default opacity, none of
     which is guaranteed to clear 4.5:1 against this dark input background. --ink-dim itself
     passes comfortably (~6:1) here, so setting it directly (and opacity: 1, since Firefox
     applies its own dimming on top of the color otherwise) makes the contrast a property of
     this stylesheet, not of whichever browser the reviewer happens to be running. */
  .composer-row textarea::placeholder { color: var(--ink-dim); opacity: 1; }
  .composer-row button {
    appearance: none; border: 0; border-radius: var(--radius-sm); padding: var(--space-2) var(--space-4);
    font: inherit; font-weight: 600; cursor: pointer;
    background: linear-gradient(155deg, #8171ff, var(--ink-accent)); color: var(--ink-accent-text);
    align-self: flex-end; box-shadow: var(--shadow-sm);
    transition: opacity 0.12s ease, transform 0.1s var(--ease-out), box-shadow 0.15s var(--ease-out);
  }
  .composer-row button:hover:not(:disabled) { box-shadow: var(--shadow-glow); transform: translateY(-1px); }
  .composer-row button:active:not(:disabled) { transform: translateY(0) scale(0.97); }
  .composer-row button:disabled { opacity: 0.4; cursor: default; transform: none; box-shadow: none; }
  .composer-row button.sending { opacity: 0.7; cursor: progress; }
  .status { font-size: var(--text-xs); color: var(--ink-dim); padding: 0 var(--space-4) var(--space-2); min-height: 14px; }
  .status.success { color: var(--ink-success); }
  .status.error { color: var(--ink-error); }

  /* Issue #59: a themed in-app modal replacing window.confirm() for the End-session prompt —
     the native dialog can't be styled and reads as generic browser chrome next to the rest of
     this shell. */
  .modal-overlay {
    display: none; position: fixed; inset: 0; z-index: 10;
    align-items: center; justify-content: center;
    background: rgba(6, 6, 9, 0.72); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
    animation: overlayIn 0.15s var(--ease-out);
  }
  .modal-overlay.visible { display: flex; }
  @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
  .modal {
    width: min(320px, calc(100vw - var(--space-4) * 2));
    background: var(--ink-panel-raised); border: 1px solid var(--ink-border); border-radius: var(--radius-lg);
    padding: var(--space-4); box-shadow: var(--shadow-lg);
    animation: modalIn 0.18s var(--ease-out);
  }
  @keyframes modalIn {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .modal-title { font-weight: 700; font-size: var(--text-md); margin-bottom: var(--space-2); }
  .modal-body { color: var(--ink-dim); font-size: var(--text-sm); line-height: 1.5; }
  .modal-body code {
    background: #1a1a22; border-radius: 4px; padding: 1px 4px; color: var(--ink-text);
    font-size: var(--text-xs);
  }
  .modal-actions {
    display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-4);
  }
  .modal-actions button {
    appearance: none; border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
    font: inherit; cursor: pointer;
    transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out), transform 0.1s var(--ease-out);
  }
  .modal-actions button:active { transform: scale(0.97); }
  .modal-cancel { border: 1px solid var(--ink-border); background: transparent; color: var(--ink-text); }
  .modal-cancel:hover { border-color: var(--ink-dim); }
  .modal-confirm { border: 1px solid var(--ink-error); background: var(--ink-error); color: var(--ink-accent-text); }
  .modal-confirm:hover { opacity: 0.9; box-shadow: 0 4px 16px rgba(255, 107, 107, 0.25); }

  /* Issue #43: below ~900px, the side panel's fixed width becomes the scarcer resource rather
     than the vertical space it reclaims — fold back into a full-width bottom dock, the layout
     the original bottom-dock design was tuned for. Pure CSS, no JS/state: the same DOM just
     reflows depending on viewport width. */
  @media (max-width: 900px) {
    .content { flex-direction: column; }
    aside#dock {
      flex: 0 0 auto; width: 100%; max-height: 45vh;
      border-left: 0; border-top: 1px solid var(--ink-border);
    }
    .thread { flex-direction: row; overflow-x: auto; overflow-y: visible; max-height: none; }
    .pill { flex: 0 0 auto; max-width: 260px; min-width: 120px; }
    .composer-row { flex-direction: row; align-items: flex-start; }
    .composer-row textarea { flex: 1; max-height: 160px; }
    .composer-row button { align-self: stretch; }
    /* The handle only ever shows once the drawer is gone (same display:none-gated rule as
       desktop), so it sits at the true viewport bottom edge rather than tracking the drawer's own
       max-height — nothing left below it to leave a gap against. */
    .dock-handle {
      top: auto; right: auto; bottom: 0; left: 50%; width: 60px; height: 22px;
      border-right: 1px solid var(--ink-border); border-bottom: 0; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      transform: translateX(-50%);
    }
    .dock-handle:active { transform: translateX(-50%) scale(0.93); }
    .dock-handle-arrow { transform: rotate(90deg); }
  }

  /* Issue #42 follow-up: the premium pass above added several entrance/press animations (banner
     slide-in, pill fade-in, modal scale-in, button press-scale) and transitions (hover lift, focus
     glow) — none of them convey information on their own, so a reviewer with vestibular motion
     sensitivity or who has set the OS-level "reduce motion" preference should get the same end
     states instantly instead of riding out every animation and transition. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
</style>
</head>
<body>
<header>
  <span class="wordmark">inkloop</span>
  <span class="session-path">session ${hash}</span>
  <button type="button" class="pick" id="pick-btn" aria-pressed="false">
    <span class="pick-dot" aria-hidden="true"></span><span id="pick-label">Sidenote</span>
  </button>
  <button type="button" class="end-session" id="end-btn">End session</button>
</header>
<div class="picking-hint" id="picking-hint" role="status" aria-live="polite">Click an element in the artifact to annotate it — click “Stop Sidenote” again to stop.</div>
<div class="ended-banner" id="ended-banner" role="status" aria-live="polite">Session ended. Run <code>inkloop &lt;file&gt; --reopen</code> to resume review.</div>
<div class="tab-banner" id="tab-banner" role="status" aria-live="polite">This session may be open in another tab — annotations from both could interleave.</div>
<div class="content">
  <main>
    <iframe id="artifact-frame" src="/session/${hash}/artifact" title="artifact preview"></iframe>
  </main>
  <button type="button" class="dock-handle" id="dock-handle" aria-expanded="true" aria-controls="dock" aria-label="Show side panel"><span class="dock-handle-arrow" aria-hidden="true">◂</span></button>
  <aside id="dock">
    <div class="dock-header-row">
      <span class="dock-section-label" id="history-label">History · 0 rounds, 0 comments</span>
      <button type="button" class="dock-collapse-btn" id="dock-collapse-btn" aria-expanded="true" aria-controls="dock" aria-label="Hide side panel">${dockToggleIcon}</button>
    </div>
    <div class="history-panel" id="history-panel"></div>
    <div class="thread" id="thread">
      <div class="thread-empty">No annotations queued yet — select an element, select text, or write a note below.</div>
    </div>
    <div class="suggestions" id="suggestions"></div>
    <div class="composer-row">
      <textarea id="composer" placeholder="Write a note to agent…" aria-label="Note to agent"></textarea>
      <button type="button" id="send-btn" disabled>Send</button>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
  </aside>
</div>
<div class="modal-overlay" id="end-modal-overlay">
  <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="end-modal-title">
    <div class="modal-title" id="end-modal-title">End review session?</div>
    <div class="modal-body">Ends this review session. Resume it later with <code>inkloop &lt;file&gt; --reopen</code>.</div>
    <div class="modal-actions">
      <button type="button" class="modal-cancel" id="end-modal-cancel">Cancel</button>
      <button type="button" class="modal-confirm" id="end-modal-confirm">End session</button>
    </div>
  </div>
</div>
<script>
(function () {
  var iframe = document.getElementById('artifact-frame');
  var pickBtn = document.getElementById('pick-btn');
  var pickLabel = document.getElementById('pick-label');
  var endBtn = document.getElementById('end-btn');
  var endedBanner = document.getElementById('ended-banner');
  var tabBanner = document.getElementById('tab-banner');
  var pickingHint = document.getElementById('picking-hint');
  var thread = document.getElementById('thread');
  var composer = document.getElementById('composer');
  var sendBtn = document.getElementById('send-btn');
  var statusEl = document.getElementById('status');
  var historyPanel = document.getElementById('history-panel');
  var historyLabel = document.getElementById('history-label');
  var suggestionsEl = document.getElementById('suggestions');
  var endModalOverlay = document.getElementById('end-modal-overlay');
  var endModalCancel = document.getElementById('end-modal-cancel');
  var endModalConfirm = document.getElementById('end-modal-confirm');
  var dockHandle = document.getElementById('dock-handle');
  var dockCollapseBtn = document.getElementById('dock-collapse-btn');
  var picking = false;
  // Issue #73: candidate starter prompts from the SDK's DOM heuristics over the currently-loaded
  // artifact. Recomputed by the SDK on every load (including live reloads), but only ever shown
  // while this session's history is still empty — see renderSuggestions.
  var suggestions = [];
  var pickingHintTimer;
  var pickingHintFadeTimer;
  var items = [];
  // Issue #63: backup of the items a send is in flight for, so an 'inkloop:send-error' can put
  // them back after the optimistic clear below. Null whenever no send is in flight.
  var pendingSendItems = null;
  var lastScrollY = 0;
  var ended = false;
  var reloadPollingActive = true;
  var SESSION_HASH = ${JSON.stringify(hash)};

  // Issue #40: a per-tab id, stable for this tab's lifetime (sessionStorage, not localStorage —
  // a duplicated tab or a fresh page load in the same tab both get a new id, which is what
  // "another tab" should mean here) but different from any other tab's, including one opened on
  // the exact same session URL. Sent on every reload poll below so the server can tell two live
  // tabs apart without any explicit pairing step.
  function makeTabId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  var TAB_ID = (function () {
    try {
      var key = 'inkloop-tab-id:' + SESSION_HASH;
      var existing = window.sessionStorage.getItem(key);
      if (existing) return existing;
      var fresh = makeTabId();
      window.sessionStorage.setItem(key, fresh);
      return fresh;
    } catch (e) {
      return makeTabId();
    }
  })();

  // Issue #79: hide/show the side dock to hand its 340px back to the artifact. Persisted per
  // session (not per-tab like TAB_ID above — a reviewer who collapses it expects that to stick
  // across reloads/tabs of the same session, same as any other layout preference would).
  var DOCK_COLLAPSED_KEY = 'inkloop-dock-collapsed:' + SESSION_HASH;

  function setDockCollapsed(collapsed) {
    document.body.classList.toggle('dock-collapsed', collapsed);
    // Both buttons carry the same aria-expanded/aria-controls pair — only one is ever visible
    // (the CSS above shows dock-handle exclusively while collapsed), but keeping both in sync
    // means whichever one a screen reader lands on reports the real state.
    dockHandle.setAttribute('aria-expanded', String(!collapsed));
    dockCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
    try {
      window.sessionStorage.setItem(DOCK_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (e) {
      // sessionStorage unavailable (private mode, etc.) — the toggle still works for this load,
      // it just won't survive a reload, same fallback as TAB_ID above.
    }
  }

  (function () {
    var initiallyCollapsed = false;
    try {
      initiallyCollapsed = window.sessionStorage.getItem(DOCK_COLLAPSED_KEY) === '1';
    } catch (e) {}
    setDockCollapsed(initiallyCollapsed);
  })();

  dockHandle.addEventListener('click', function () { setDockCollapsed(false); });
  dockCollapseBtn.addEventListener('click', function () { setDockCollapsed(true); });

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Issue #27: element and text-range anchors need to read as visually distinct at a glance,
  // not just by label text — a dotted-box glyph for a picked element vs. a quote glyph for a
  // picked text range, both prefixed onto the same uppercase label everywhere targetLabel is used
  // (draft pills and round-history entries alike).
  function targetLabel(target) {
    if (!target) return '✎ note';
    if (target.kind === 'element') return '□ element';
    if (target.kind === 'text-range') return '❝ selection';
    return '✎ note';
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.classList.remove('success', 'error');
    if (kind) statusEl.classList.add(kind);
  }

  function render() {
    if (items.length === 0) {
      // The onboarding-style hint ("select an element, select text, or write a note below") only
      // earns its place before the reviewer has ever sent anything - once a session has real
      // history (any round, ever), they already know how the composer works, and re-showing the
      // same instructional copy every time the queue happens to empty out again just reads as
      // noise. lastHistory is declared further down but hoisted (var) and already populated by
      // the time render() is ever called - see the bottom of this script.
      var hasHistory = (lastHistory.rounds || []).length > 0;
      thread.innerHTML = hasHistory
        ? ''
        : '<div class="thread-empty">No annotations queued yet — select an element, select text, or write a note below.</div>';
    } else {
      thread.innerHTML = items.map(function (item) {
        var quote = item.target && item.target.quote
          ? '“' + escapeHtml(String(item.target.quote).slice(0, 60)) + '” — '
          : '';
        var id = escapeHtml(item.id);
        return '<div class="pill" data-id="' + id + '">'
          + '<button type="button" class="pill-remove" data-id="' + id + '" aria-label="Remove annotation">×</button>'
          + '<div class="pill-target">' + targetLabel(item.target) + '</div>'
          + '<div class="pill-comment">' + quote + escapeHtml(item.comment) + '</div></div>';
      }).join('');
    }
    // Only touch the disabled state here — the "sending" in-flight state is driven separately
    // by the send button's own click handler and the sent/error responses below.
    if (!sendBtn.classList.contains('sending')) updateSendButtonEnabled();
    // Issue #38: keep the history label's queued count in sync with every queue change too, not
    // just with the sent-history refetch — updateHistoryLabel is defined below but already
    // hoisted by the time render() is ever called (first call is render() at the bottom of this
    // script, after every function in this closure has been declared).
    updateHistoryLabel();
  }

  // ---- Round-history panel (issue #21, reflowed into the side panel by #43) -----------------
  // Past rounds of sent annotations paired with the agent's reply for that round (labeled
  // "Agent" — see roundHtml below), if any. Always visible in its own scrollable section of the
  // side panel now — the
  // collapse/expand toggle from the bottom-dock version existed to reclaim vertical space the
  // dock was borrowing from the artifact; a fixed-width side panel doesn't borrow that space, so
  // there's nothing left to reclaim and the toggle is gone.

  // Issue #38: the label used to be driven only by server-side sent history, so it read
  // "0 rounds · 0 comments" the entire time annotations sat queued-but-unsent in the composer —
  // indistinguishable from a session with nothing queued at all. lastHistory carries the
  // last-fetched sent-round counts forward so updateHistoryLabel can combine them with the live
  // (unsent) queue length from render(), regardless of which one changed most recently.
  var lastHistory = { rounds: [], commentCount: 0 };

  function updateHistoryLabel() {
    var rounds = lastHistory.rounds || [];
    var commentCount = lastHistory.commentCount || 0;
    var label = rounds.length + (rounds.length === 1 ? ' round' : ' rounds')
      + ' · ' + commentCount + (commentCount === 1 ? ' comment' : ' comments');
    if (items.length > 0) {
      label += ' · ' + items.length + ' queued';
    }
    historyLabel.textContent = label;
  }

  // Issue #76: once a round is fully delivered there's no real "percent done" to show — the only
  // honest signal is "the agent has it and hasn't replied yet". A single static "Agent has it"
  // label reads the same whether that's been true for two seconds or twenty minutes, which is
  // exactly the "can't tell working from stuck" complaint the issue opened with. Rotating through
  // a word bank (picked deterministically per round, below) at least keeps the label feeling
  // alive tick to tick instead of static text a reviewer stops trusting is still updating.
  var WORKING_VERBS = [
    'Pondering', 'Untangling', 'Noodling', 'Reworking', 'Sketching', 'Threading',
    'Polishing', 'Wrangling', 'Tinkering', 'Marinating', 'Brewing'
  ];

  /**
   * Issue #76: derives a round's status purely from data readSessionHistory already returns —
   * no new endpoint, no CLI-side "I'm working on it" heartbeat to keep alive. deliveredAt is
   * set server-side the instant an inkloop poll call claims a round (see feedback-store.ts's
   * takePendingFeedback), so "every item delivered, no reply yet" is as close as this shell can
   * get to "agent has it" without inventing a signal the CLI doesn't actually emit.
   */
  function roundStatus(round) {
    if (round.reply) return { key: 'revised', label: 'Revised' };
    var roundItems = round.items || [];
    var allDelivered = roundItems.length > 0 && roundItems.every(function (item) { return Boolean(item.deliveredAt); });
    if (allDelivered) {
      // round.round is a stable, server-assigned integer (see FeedbackItem.round's docstring), so
      // this picks the same verb for the same round on every re-render instead of flickering on
      // each history refresh — "random-looking" across rounds, not literally Math.random().
      var verb = WORKING_VERBS[round.round % WORKING_VERBS.length];
      return { key: 'delivered', label: verb + '…' };
    }
    return { key: 'queued', label: 'Queued' };
  }

  // Factored out of renderHistory so the optimistic-send path below (issue #63) can render the
  // exact same markup for a round that hasn't round-tripped to the server yet.
  function roundHtml(round, pending) {
    var itemsHtml = round.items.map(function (item) {
      var quote = item.target && item.target.quote
        ? '“' + escapeHtml(String(item.target.quote).slice(0, 60)) + '” — '
        : '';
      // Issue #10: the SDK flags an item as drifted when its anchored text no longer matches
      // the live artifact — surfaced here so a human sees why an agent might ask to re-anchor
      // instead of resolving it, not just in the raw poll payload the agent itself receives.
      var driftNote = item.drifted
        ? '<span class="history-item-drift-note">⚠ Anchor text changed since this was sent</span>'
        : '';
      return '<div class="history-item' + (item.drifted ? ' drifted' : '') + '">'
        + '<span class="history-item-target">' + targetLabel(item.target) + '</span>'
        + '<span class="history-item-comment">' + quote + escapeHtml(item.comment) + '</span>'
        + driftNote + '</div>';
    }).join('');
    var replyHtml = round.reply
      ? '<div class="history-reply"><div class="history-reply-label">Agent</div>'
        + '<div class="history-reply-message">' + escapeHtml(round.reply.message) + '</div></div>'
      : '';
    var status = pending ? { key: 'sending', label: 'Sending…' } : roundStatus(round);
    // Once a round has a reply, "Agent revised" + the reply text below already says it's done -
    // a "REVISED" pill on top of that is redundant, and across many rounds a whole history of
    // solid-green pills would just be visual noise. The badge earns its place on rounds still
    // in flight (queued or delivered-but-no-reply-yet), where it's the only signal available.
    var statusHtml = status.key === 'revised'
      ? ''
      : '<span class="history-round-status status-' + status.key + '">'
        + '<span class="status-text">' + escapeHtml(status.label) + '</span></span>';
    return '<div class="history-round' + (pending ? ' pending' : '') + '">'
      + '<div class="history-round-label"><span>Round ' + round.round + '</span>' + statusHtml + '</div>'
      + '<div class="history-items">' + itemsHtml + '</div>' + replyHtml + '</div>';
  }

  // Issue #78: the panel never scrolled itself, so a reviewer several rounds into a session had
  // to manually scroll down to see the newest round (and, after #76, its live status badge) every
  // time one landed. Only auto-scrolls when the reviewer was already at (or near) the bottom —
  // scrolled up to reread an earlier round, a fresh round arriving shouldn't yank the view away.
  var HISTORY_SCROLL_BOTTOM_SLACK_PX = 24;

  function isHistoryPanelNearBottom() {
    return historyPanel.scrollHeight - historyPanel.scrollTop - historyPanel.clientHeight
      < HISTORY_SCROLL_BOTTOM_SLACK_PX;
  }

  function scrollHistoryPanelToBottom() {
    historyPanel.scrollTop = historyPanel.scrollHeight;
  }

  function renderHistory(history) {
    lastHistory = history || lastHistory;
    var rounds = lastHistory.rounds || [];
    updateHistoryLabel();
    renderSuggestions();

    // fetchHistory() ticks alongside every reload long-poll response (~every pollTimeoutMs), not
    // just when a round actually changed, and this rebuilds the panel wholesale every time - a
    // full innerHTML replacement tears down the old nodes, so the browser doesn't reliably keep
    // scrollTop where it was (it may reset to 0, or land somewhere arbitrary via scroll-anchoring
    // guessing at a similar-looking node in the new markup). Both captured up front, before
    // anything below can disturb them, and restored explicitly after rather than trusted to
    // survive the replacement on their own.
    var wasNearBottom = isHistoryPanelNearBottom();
    var prevScrollTop = historyPanel.scrollTop;

    if (rounds.length === 0) {
      historyPanel.innerHTML = '<div class="history-empty">No rounds sent yet.</div>';
    } else {
      historyPanel.innerHTML = rounds.map(function (round) { return roundHtml(round, false); }).join('');
      // Was already at (or near) the bottom - follow new content down. Otherwise, put the
      // reviewer back exactly where they were reading rather than wherever the DOM replacement
      // happened to leave the scroll position.
      historyPanel.scrollTop = wasNearBottom ? historyPanel.scrollHeight : prevScrollTop;
    }

    // render()'s empty-queue branch decides whether to show the "select an element…" onboarding
    // hint based on lastHistory, which this function just updated above - without re-running it
    // here, a queue that was already empty before this round's Send resolved would go on showing
    // the onboarding hint forever after, since nothing else re-evaluates it once the queue itself
    // stops changing.
    render();
  }

  /**
   * Issue #73: renders the SDK's DOM-heuristic starter prompts as dismissible chips above the
   * composer, but only while this session has no sent rounds yet — once a reviewer has sent real
   * feedback, generic "here's something you might ask" hints have served their purpose and would
   * just crowd a panel that now has actual history to show. Re-evaluated on every renderHistory
   * call (the same trigger that updates lastHistory.rounds), not just when a new suggestions
   * message arrives, so sending the first round hides the block immediately rather than waiting
   * for the next artifact reload.
   */
  function renderSuggestions() {
    var hasHistory = (lastHistory.rounds || []).length > 0;
    if (hasHistory || suggestions.length === 0) {
      suggestionsEl.classList.remove('visible');
      suggestionsEl.innerHTML = '';
      return;
    }
    suggestionsEl.classList.add('visible');
    suggestionsEl.innerHTML = '<div class="suggestions-label">Suggested</div>'
      + suggestions.map(function (text, i) {
        return '<div class="suggestion-chip" data-index="' + i + '" role="button" tabindex="0">'
          + '<button type="button" class="suggestion-chip-remove" data-index="' + i + '" aria-label="Dismiss suggestion">×</button>'
          + escapeHtml(text) + '</div>';
      }).join('');
  }

  // Clicking a chip populates the composer (not auto-send, so the reviewer can edit first);
  // clicking its × dismisses just that one suggestion. Delegated on the container since the chips
  // are rebuilt wholesale on every renderSuggestions call.
  suggestionsEl.addEventListener('click', function (event) {
    var target = event.target;
    var removeBtn = target && target.closest ? target.closest('.suggestion-chip-remove') : null;
    if (removeBtn) {
      var removeIndex = Number(removeBtn.getAttribute('data-index'));
      suggestions.splice(removeIndex, 1);
      renderSuggestions();
      return;
    }
    var chip = target && target.closest ? target.closest('.suggestion-chip') : null;
    if (!chip) return;
    var text = suggestions[Number(chip.getAttribute('data-index'))];
    if (text === undefined) return;
    composer.value = text;
    updateSendButtonEnabled();
    composer.focus();
  });

  // role="button" chips need Enter/Space to behave like the click handler above, since a <div>
  // (unlike <button>) doesn't get that for free from the browser.
  suggestionsEl.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var target = event.target;
    if (target && target.closest && target.closest('.suggestion-chip-remove')) return;
    var chip = target && target.closest ? target.closest('.suggestion-chip') : null;
    if (!chip) return;
    event.preventDefault();
    chip.click();
  });

  /**
   * Issue #63: paints the round being sent into the history panel the instant Send is clicked,
   * instead of leaving the panel showing its pre-send state until the POST /feedback + GET
   * /history round trip resolves (visibly ~1-2s on top of the composer already having cleared).
   * The follow-up fetchHistory() call this same click triggers overwrites the whole panel with
   * the server's authoritative rounds shortly after, which naturally replaces this pending entry
   * with the real one — same content, so the swap is invisible. On a send error the pending round
   * is dropped by re-rendering lastHistory as-is (see the 'inkloop:send-error' handler below).
   */
  function renderPendingRound(itemsForRound) {
    if (itemsForRound.length === 0) return;
    var roundNum = (lastHistory.rounds || []).length + 1;
    var html = roundHtml({ round: roundNum, items: itemsForRound, reply: null }, true);
    if (historyPanel.querySelector('.history-empty')) historyPanel.innerHTML = '';
    historyPanel.insertAdjacentHTML('beforeend', html);
    // A reviewer who just clicked Send is, by definition, engaged with the panel right now - the
    // pending round they're about to watch resolve should always land in view, regardless of
    // scroll position (unlike renderHistory's more conservative "only if already near bottom",
    // used for rounds arriving from elsewhere - the agent's reply, another tab's Send).
    scrollHistoryPanelToBottom();
  }

  function fetchHistory() {
    fetch('/session/' + SESSION_HASH + '/history')
      .then(function (res) { return res.json(); })
      .then(renderHistory)
      .catch(function () {
        // Best-effort — a failed refresh just leaves the panel showing its last-known state
        // until the next tick (piggybacked on pollReload below) succeeds.
      });
  }

  function postToFrame(message) {
    if (!iframe.contentWindow) return;
    iframe.contentWindow.postMessage(message, window.location.origin);
  }

  // Issue #61: the hint banner only needs to teach the mechanism once per activation — after
  // this long showing it in full, it fades out and hides, leaving the toggle button's own
  // active/pressed state as the persistent "picking is still on" indicator.
  var PICKING_HINT_VISIBLE_MS = 4000;
  var PICKING_HINT_FADE_MS = 300;

  function setPicking(value) {
    picking = value;
    pickBtn.classList.toggle('active', picking);
    pickBtn.setAttribute('aria-pressed', String(picking));
    pickLabel.textContent = picking ? 'Stop Sidenote' : 'Sidenote';
    clearTimeout(pickingHintTimer);
    clearTimeout(pickingHintFadeTimer);
    pickingHint.classList.remove('fading');
    if (!picking) {
      pickingHint.classList.remove('visible');
      return;
    }
    pickingHint.classList.add('visible');
    pickingHintTimer = setTimeout(function () {
      pickingHint.classList.add('fading');
      pickingHintFadeTimer = setTimeout(function () {
        pickingHint.classList.remove('visible');
      }, PICKING_HINT_FADE_MS);
    }, PICKING_HINT_VISIBLE_MS);
  }

  /**
   * User-initiated end (issue #9): disables every interaction the shell offers once the session
   * is over — there's nothing meaningful left for a human to annotate or an agent to receive,
   * since the server refuses a later plain inkloop-open call to reopen without --reopen. Reload
   * polling stops too (reloadPollingActive below) — no point watching a file for a session no
   * longer being reviewed.
   */
  function markEnded() {
    ended = true;
    reloadPollingActive = false;
    endedBanner.classList.add('visible');
    endBtn.disabled = true;
    pickBtn.disabled = true;
    sendBtn.disabled = true;
    composer.disabled = true;
    if (picking) postToFrame({ type: 'inkloop:toggle-element-picker' });
  }

  /**
   * Issue #59: a themed in-app modal replaces window.confirm() here — a native confirm() can't
   * be styled and reads oddly out of place next to the rest of this shell (and the repo's own
   * browser-automation guidance flags it as something to avoid relying on where avoidable).
   */
  function showEndModal() {
    endModalOverlay.classList.add('visible');
    endModalConfirm.focus();
  }

  function hideEndModal() {
    endModalOverlay.classList.remove('visible');
  }

  endBtn.addEventListener('click', function () {
    if (ended) return;
    showEndModal();
  });

  endModalCancel.addEventListener('click', hideEndModal);

  endModalOverlay.addEventListener('click', function (event) {
    if (event.target === endModalOverlay) hideEndModal();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && endModalOverlay.classList.contains('visible')) hideEndModal();
  });

  endModalConfirm.addEventListener('click', function () {
    hideEndModal();
    endBtn.disabled = true;
    fetch('/session/' + SESSION_HASH + '/end', { method: 'POST' })
      .then(function (res) {
        if (!res.ok) throw new Error('server responded ' + res.status);
        markEnded();
        setStatus('Session ended.', 'success');
      })
      .catch(function (err) {
        endBtn.disabled = false;
        setStatus('Failed to end session: ' + err.message, 'error');
      });
  });

  pickBtn.addEventListener('click', function () {
    // Don't flip local state optimistically here — picking mode also turns itself off inside
    // the SDK the moment an element is picked, not just on this toggle, so this shell waits for
    // the SDK's own 'inkloop:picking' message to stay in sync (issue #18).
    postToFrame({ type: 'inkloop:toggle-element-picker' });
  });

  /**
   * Issue #60: Send is the only way anything leaves the composer now — typing in the box alone
   * (with nothing queued yet) is enough to enable it, same as having queued pills already does.
   * Enter no longer queues a separate item (dropped entirely, below); a plain <textarea>'s default
   * behavior — inserting a newline — applies with no special-casing.
   */
  function updateSendButtonEnabled() {
    sendBtn.disabled = items.length === 0 && composer.value.trim().length === 0;
  }

  composer.addEventListener('input', updateSendButtonEnabled);

  /**
   * Issue #70: Enter sends (matching common chat-input convention), Shift+Enter still inserts a
   * newline via the textarea's default behavior. Enter-to-send is a different action from the
   * Enter-to-queue that issue #60 deliberately dropped (queuing a separate pill on Enter, which
   * read as surprising) — this reuses the same path as clicking Send, not a queue action.
   * Delegating to sendBtn.click() (rather than duplicating the click handler's body) means the
   * button's own disabled state — set during an in-flight send or once the session has ended —
   * is respected for free; a disabled button's click() is a no-op.
   */
  composer.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    sendBtn.click();
  });

  thread.addEventListener('click', function (event) {
    var target = event.target;
    var removeBtn = target && target.closest ? target.closest('.pill-remove') : null;
    if (!removeBtn) return;
    var id = removeBtn.getAttribute('data-id');
    if (id) postToFrame({ type: 'inkloop:remove', id: id });
  });

  sendBtn.addEventListener('click', function () {
    // Issue #60: fold the composer's current text in as an additional note in the same batch,
    // rather than silently dropping it — 'inkloop:add-comment' queues it inside the SDK before
    // 'inkloop:send' reads the queue, and postMessage delivery order is FIFO, so it's guaranteed
    // to land in the same send.
    var noteText = composer.value.trim();
    var itemsBeingSent = items.slice();
    if (noteText) {
      postToFrame({ type: 'inkloop:add-comment', comment: noteText });
      itemsBeingSent.push({ target: { kind: 'general' }, comment: noteText });
      composer.value = '';
    }

    // Issue #63: optimistic UI — move the queued draft into the history panel and clear the
    // thread right away, instead of leaving both showing their pre-send state until the SDK's
    // POST /feedback resolves. pendingSendItems keeps a backup to restore if the send fails.
    pendingSendItems = items;
    items = [];
    render();
    renderPendingRound(itemsBeingSent);

    // Issue #73: once a reviewer has sent anything, the "blank slate" starter prompts have
    // served their purpose — clear them right away on click rather than waiting for
    // renderHistory's hasHistory check to catch up after the round-trip resolves. Not restored on
    // a failed send (below): the reviewer has already engaged with the composer by that point, so
    // there's no going back to "first open" state.
    suggestions = [];
    renderSuggestions();

    sendBtn.disabled = true;
    sendBtn.classList.add('sending');
    sendBtn.textContent = 'Sending…';
    setStatus('', null);
    postToFrame({ type: 'inkloop:send' });
  });

  function resetSendButton() {
    sendBtn.classList.remove('sending');
    sendBtn.textContent = 'Send';
    updateSendButtonEnabled();
  }

  window.addEventListener('message', function (event) {
    if (event.source !== iframe.contentWindow || event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data.source !== 'inkloop-sdk') return;

    if (data.type === 'inkloop:picking') {
      setPicking(Boolean(data.active));
    } else if (data.type === 'inkloop:queue') {
      // Issue #63: while a send is in flight, pendingSendItems owns items (optimistically
      // cleared on click). The SDK's own queue echo from the 'inkloop:add-comment' the Send
      // click just posted arrives here before the POST /feedback resolves, so ignore it until
      // 'inkloop:sent'/'inkloop:send-error' reconciles the optimistic state.
      if (pendingSendItems === null) {
        items = data.items || [];
        render();
      }
    } else if (data.type === 'inkloop:sent') {
      pendingSendItems = null;
      resetSendButton();
      // No "Sent." status line here (issue #76 follow-up) - the round-status badge that lands in
      // the history panel a moment later (via fetchHistory below) already says as much, and
      // outlives this transient line anyway once the reviewer looks away and back.
      fetchHistory();
    } else if (data.type === 'inkloop:send-error') {
      // Roll back the optimistic update above: put the unsent items back in the thread and drop
      // the pending round from the history panel (a plain re-render of lastHistory, which never
      // included it). Restore from the SDK's own current queue (data.items) rather than the
      // pendingSendItems snapshot taken before the click folded the composer's text in via
      // 'inkloop:add-comment' - that fold-in landed in the SDK's queue even though the send
      // failed, so pendingSendItems alone would silently drop it from view.
      if (pendingSendItems) {
        items = Array.isArray(data.items) ? data.items : pendingSendItems;
        pendingSendItems = null;
        render();
      }
      renderHistory(lastHistory);
      resetSendButton();
      setStatus('Failed to send: ' + data.message, 'error');
    } else if (data.type === 'inkloop:scroll') {
      lastScrollY = data.scrollY || 0;
    } else if (data.type === 'inkloop:suggestions') {
      // Issue #73: replaces (not merges with) any prior batch — a fresh artifact load means a
      // fresh set of candidates, and stale ones from a since-revised artifact aren't worth
      // keeping around just because a reviewer hadn't dismissed them yet.
      suggestions = Array.isArray(data.prompts) ? data.prompts : [];
      renderSuggestions();
    } else if (data.type === 'inkloop:ready') {
      // Fires on the iframe's very first load too (where items is [] and lastScrollY is 0, a
      // harmless no-op) as well as after every live-reload (issue #8) — the one place this
      // shell needs to hand the fresh SDK instance back its own unsent draft and scroll
      // position, since a full iframe reload wipes the SDK's in-memory state but not this
      // shell's own (items/lastScrollY survive here untouched).
      postToFrame({ type: 'inkloop:restore-draft', queue: items, scrollY: lastScrollY });
    }
  });

  // ---- Live reload (issue #8) -------------------------------------------------------------
  // Long-polls the same way the CLI's poll command does server-side (see create-server.ts's
  // /session/:hash/reload route): each request is bounded, an unchanged result just means
  // "nothing yet", and this re-issues immediately either way — no backoff needed since the
  // route itself is what bounds request frequency.

  function pollReload(sinceVersion) {
    if (!reloadPollingActive) return;
    fetch('/session/' + SESSION_HASH + '/reload?since=' + sinceVersion + '&tab=' + encodeURIComponent(TAB_ID))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var version = data.version || 0;
        if (version > sinceVersion) {
          iframe.src = '/session/' + SESSION_HASH + '/artifact?v=' + version;
        }
        // Issue #40: same long-poll cadence doubles as this tab's presence heartbeat — see
        // tab-presence.ts. Not sticky once true: if the other tab goes stale (closed, or this
        // banner was reacting to a leftover tab from an earlier sitting), the banner clears on
        // the next tick same as it appeared.
        tabBanner.classList.toggle('visible', Boolean(data.otherTabActive));
        // Piggybacks the history refresh on this same long-poll cadence (issue #21) so an
        // agent's --agent-reply flag, which has no other signal reaching this shell, still shows
        // up within one reload tick, without standing up a second long-poll loop just for it.
        fetchHistory();
        pollReload(version);
      })
      .catch(function () {
        // A transient network hiccup (e.g. the server restarting) isn't worth surfacing as an
        // error — back off briefly and keep trying at the same version.
        setTimeout(function () { pollReload(sinceVersion); }, 2000);
      });
  }
  pollReload(0);

  // Issue #65: tell the server this tab is gone the moment it actually is, instead of leaving
  // its presence to age out of the reload-poll heartbeat (up to 3x the poll timeout) — without
  // this, closing a tab could still make the next tab opened on this session see a stale "open
  // in another tab" banner. 'pagehide' fires on a real close, a navigation away, and a reload,
  // unlike 'beforeunload' which doesn't reliably fire on mobile/backgrounding; sendBeacon is the
  // right tool here since the page is unloading and nothing could react to a normal fetch's
  // response anyway.
  window.addEventListener('pagehide', function () {
    if (!navigator.sendBeacon) return;
    var payload = new Blob([JSON.stringify({ tabId: TAB_ID })], { type: 'application/json' });
    navigator.sendBeacon('/session/' + SESSION_HASH + '/tab-leave', payload);
  });

  render();
  fetchHistory();
})();
</script>
</body>
</html>
`;
}
