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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>inkloop review</title>
<style>
  :root {
    --ink-bg: #0b0b0f;
    --ink-panel: #141419;
    --ink-border: #242430;
    --ink-text: #e9e9ee;
    --ink-dim: #8f8fa3;
    --ink-accent: #6f5bff;
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
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
    background: var(--ink-bg); color: var(--ink-text);
  }
  body { display: flex; flex-direction: column; }
  header {
    flex: 0 0 auto; display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--ink-border); background: var(--ink-panel);
  }
  .wordmark { font-weight: 700; letter-spacing: 0.02em; }
  .wordmark::before { content: "⌁ "; color: var(--ink-accent); }
  .session-path {
    flex: 1; color: var(--ink-dim); font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  button.pick {
    appearance: none; border: 1px solid var(--ink-border); background: transparent;
    color: var(--ink-text); padding: var(--space-2) var(--space-3); border-radius: 6px;
    font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: var(--space-2);
    transition: background-color 0.12s ease, border-color 0.12s ease;
  }
  button.pick:hover { border-color: var(--ink-accent); }
  button.pick.active { background: var(--ink-accent); border-color: var(--ink-accent); color: var(--ink-accent-text); }
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
    color: var(--ink-error); padding: var(--space-2) var(--space-3); border-radius: 6px;
    font: inherit; cursor: pointer; transition: background-color 0.12s ease, border-color 0.12s ease;
  }
  button.end-session:hover { border-color: var(--ink-error); background: rgba(255, 107, 107, 0.1); }
  button.end-session:disabled { opacity: 0.4; cursor: default; }
  .ended-banner {
    flex: 0 0 auto; display: none; align-items: center;
    padding: var(--space-2) var(--space-4); font-size: 12px; color: var(--ink-accent-text);
    background: var(--ink-error); border-bottom: 1px solid var(--ink-border);
  }
  .ended-banner.visible { display: flex; }
  .tab-banner {
    flex: 0 0 auto; display: none; align-items: center;
    padding: var(--space-2) var(--space-4); font-size: 12px; color: var(--ink-agent);
    background: var(--ink-agent-soft); border-bottom: 1px solid var(--ink-border);
  }
  .tab-banner.visible { display: flex; }
  .picking-hint {
    flex: 0 0 auto; display: none; align-items: center;
    padding: var(--space-2) var(--space-4); font-size: 12px; color: var(--ink-accent-text);
    background: var(--ink-accent); border-bottom: 1px solid var(--ink-border);
  }
  .picking-hint.visible { display: flex; }
  .content { flex: 1 1 auto; display: flex; flex-direction: row; min-height: 0; }
  main { flex: 1 1 auto; position: relative; min-height: 0; }
  iframe { border: 0; width: 100%; height: 100%; display: block; background: #fff; }
  /* Issue #43: a fixed-width right-side panel instead of the full-width bottom dock — see the
     file header comment for the reasoning and the <900px fallback below. */
  aside#dock {
    flex: 0 0 340px; width: 340px; display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--ink-border); background: var(--ink-panel);
  }
  .dock-section-label {
    flex: 0 0 auto; font-size: 11px; color: var(--ink-dim);
    padding: var(--space-3) var(--space-4) var(--space-2);
  }
  .history-panel {
    flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--space-3);
    overflow-y: auto; min-height: 80px; padding: 0 var(--space-4) var(--space-3);
  }
  .history-empty { color: var(--ink-dim); font-size: 12px; }
  .history-round { display: flex; flex-direction: column; gap: var(--space-2); }
  .history-round-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-dim);
  }
  .history-items { display: flex; flex-direction: column; gap: var(--space-1); }
  .history-item {
    border-left: 2px solid var(--ink-accent); background: var(--ink-accent-soft);
    border-radius: 0 6px 6px 0; padding: var(--space-1) var(--space-2); font-size: 12px; line-height: 1.4;
  }
  .history-item-target {
    color: var(--ink-accent-label); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.05em; margin-right: var(--space-1);
  }
  .history-item-comment { color: var(--ink-text); word-break: break-word; }
  .history-item.drifted { border-left-color: var(--ink-error); background: rgba(255, 107, 107, 0.1); }
  .history-item-drift-note {
    display: block; color: var(--ink-error); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.05em; margin-top: var(--space-1);
  }
  .history-reply {
    border-left: 2px solid var(--ink-agent); background: var(--ink-agent-soft);
    border-radius: 0 6px 6px 0; padding: var(--space-1) var(--space-2);
  }
  .history-reply-label {
    color: var(--ink-agent); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.05em; margin-bottom: var(--space-1);
  }
  .history-reply-message { color: var(--ink-text); font-size: 12px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
  /* The queued-but-unsent draft thread: a horizontally-scrolling strip in the old bottom dock,
     now a vertical stack — the side panel's column is narrower than most drafts' natural width,
     so stacking reads better than a second internal scrollbar running the other way. */
  .thread {
    flex: 0 1 auto; display: flex; flex-direction: column; gap: var(--space-2);
    overflow-y: auto; max-height: 40%; min-height: 0;
    padding: var(--space-3) var(--space-4); border-top: 1px solid var(--ink-border);
  }
  .thread-empty { color: var(--ink-dim); font-size: 12px; padding: var(--space-1) 0; }
  .thread-empty::before { content: "› "; color: var(--ink-accent); }
  .pill {
    position: relative; border: 1px solid var(--ink-border); border-radius: 8px;
    padding: var(--space-2) var(--space-3); padding-right: 26px;
    background: #1a1a22; font-size: 12px; line-height: 1.4;
    transition: border-color 0.12s ease;
  }
  .pill:hover { border-color: var(--ink-accent); }
  .pill .pill-target {
    color: var(--ink-accent-label); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.05em; margin-bottom: var(--space-1);
  }
  .pill .pill-comment { color: var(--ink-text); white-space: normal; word-break: break-word; }
  .pill-remove {
    position: absolute; top: 4px; right: 4px; width: 18px; height: 18px;
    appearance: none; border: 0; border-radius: 4px; background: transparent;
    color: var(--ink-dim); font: inherit; line-height: 1; cursor: pointer;
  }
  .pill-remove:hover { background: var(--ink-border); color: var(--ink-text); }
  /* Stacked, not the old side-by-side row — 340px isn't wide enough for a textarea and a
     same-line Send button both to read comfortably. */
  .composer-row {
    flex: 0 0 auto; display: flex; flex-direction: column; gap: var(--space-2);
    padding: var(--space-3) var(--space-4); border-top: 1px solid var(--ink-border);
  }
  .composer-row textarea {
    resize: vertical; min-height: 36px; max-height: 160px;
    background: #101014; color: var(--ink-text); border: 1px solid var(--ink-border);
    border-radius: 6px; padding: var(--space-2); font: inherit;
  }
  .composer-row textarea:focus { outline: none; border-color: var(--ink-accent); }
  .composer-row textarea:disabled { opacity: 0.4; cursor: default; }
  /* Issue #44: pinned explicitly rather than left to the browser's own placeholder styling —
     Chrome/Firefox/Safari each dim placeholder text by a different default opacity, none of
     which is guaranteed to clear 4.5:1 against this dark input background. --ink-dim itself
     passes comfortably (~6:1) here, so setting it directly (and opacity: 1, since Firefox
     applies its own dimming on top of the color otherwise) makes the contrast a property of
     this stylesheet, not of whichever browser the reviewer happens to be running. */
  .composer-row textarea::placeholder { color: var(--ink-dim); opacity: 1; }
  .composer-row button {
    appearance: none; border: 0; border-radius: 6px; padding: var(--space-2) var(--space-4);
    font: inherit; cursor: pointer; background: var(--ink-accent); color: var(--ink-accent-text);
    align-self: flex-end; transition: opacity 0.12s ease;
  }
  .composer-row button:disabled { opacity: 0.4; cursor: default; }
  .composer-row button.sending { opacity: 0.7; cursor: progress; }
  .status { font-size: 11px; color: var(--ink-dim); padding: 0 var(--space-4) var(--space-2); min-height: 14px; }
  .status.success { color: var(--ink-success); }
  .status.error { color: var(--ink-error); }

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
    .composer-row textarea { flex: 1; max-height: 120px; }
    .composer-row button { align-self: stretch; }
  }

  @media (max-width: 480px) {
    aside#dock { max-height: 55vh; }
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
<div class="picking-hint" id="picking-hint">Click an element in the artifact to annotate it — click “Cancel Sidenote” again to cancel.</div>
<div class="ended-banner" id="ended-banner">Session ended. Run <code>inkloop</code> on this file again with <code>--reopen</code> to resume review.</div>
<div class="tab-banner" id="tab-banner">This session may be open in another tab — annotations from both could interleave.</div>
<div class="content">
  <main>
    <iframe id="artifact-frame" src="/session/${hash}/artifact" title="artifact preview"></iframe>
  </main>
  <aside id="dock">
    <div class="dock-section-label" id="history-label">History · 0 rounds, 0 comments</div>
    <div class="history-panel" id="history-panel"></div>
    <div class="thread" id="thread">
      <div class="thread-empty">No annotations queued yet — select an element, select text, or write a note below.</div>
    </div>
    <div class="composer-row">
      <textarea id="composer" placeholder="Write a note… (not tied to a specific element)"></textarea>
      <button type="button" id="send-btn" disabled>Send</button>
    </div>
    <div class="status" id="status"></div>
  </aside>
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
  var picking = false;
  var items = [];
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
      thread.innerHTML = '<div class="thread-empty">No annotations queued yet — select an element, select text, or write a note below.</div>';
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
    if (!sendBtn.classList.contains('sending')) sendBtn.disabled = items.length === 0;
    // Issue #38: keep the history label's queued count in sync with every queue change too, not
    // just with the sent-history refetch — updateHistoryLabel is defined below but already
    // hoisted by the time render() is ever called (first call is render() at the bottom of this
    // script, after every function in this closure has been declared).
    updateHistoryLabel();
  }

  // ---- Round-history panel (issue #21, reflowed into the side panel by #43) -----------------
  // Past rounds of sent annotations paired with the agent's "Agent revised" reply for that
  // round, if any. Always visible in its own scrollable section of the side panel now — the
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

  function renderHistory(history) {
    lastHistory = history || lastHistory;
    var rounds = lastHistory.rounds || [];
    updateHistoryLabel();

    if (rounds.length === 0) {
      historyPanel.innerHTML = '<div class="history-empty">No rounds sent yet.</div>';
      return;
    }

    historyPanel.innerHTML = rounds.map(function (round) {
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
        ? '<div class="history-reply"><div class="history-reply-label">Agent revised</div>'
          + '<div class="history-reply-message">' + escapeHtml(round.reply.message) + '</div></div>'
        : '';
      return '<div class="history-round">'
        + '<div class="history-round-label">Round ' + round.round + '</div>'
        + '<div class="history-items">' + itemsHtml + '</div>' + replyHtml + '</div>';
    }).join('');
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

  function setPicking(value) {
    picking = value;
    pickBtn.classList.toggle('active', picking);
    pickBtn.setAttribute('aria-pressed', String(picking));
    pickLabel.textContent = picking ? 'Cancel Sidenote' : 'Sidenote';
    pickingHint.classList.toggle('visible', picking);
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

  endBtn.addEventListener('click', function () {
    if (ended) return;
    if (!window.confirm('End this review session? A later inkloop <file> will need --reopen to resume it.')) return;
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

  function submitNote() {
    var text = composer.value.trim();
    if (!text) return;
    postToFrame({ type: 'inkloop:add-comment', comment: text });
    composer.value = '';
  }

  composer.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitNote();
    }
  });

  thread.addEventListener('click', function (event) {
    var target = event.target;
    var removeBtn = target && target.closest ? target.closest('.pill-remove') : null;
    if (!removeBtn) return;
    var id = removeBtn.getAttribute('data-id');
    if (id) postToFrame({ type: 'inkloop:remove', id: id });
  });

  sendBtn.addEventListener('click', function () {
    sendBtn.disabled = true;
    sendBtn.classList.add('sending');
    sendBtn.textContent = 'Sending…';
    setStatus('', null);
    postToFrame({ type: 'inkloop:send' });
  });

  function resetSendButton() {
    sendBtn.classList.remove('sending');
    sendBtn.textContent = 'Send';
    sendBtn.disabled = items.length === 0;
  }

  window.addEventListener('message', function (event) {
    if (event.source !== iframe.contentWindow || event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data.source !== 'inkloop-sdk') return;

    if (data.type === 'inkloop:picking') {
      setPicking(Boolean(data.active));
    } else if (data.type === 'inkloop:queue') {
      items = data.items || [];
      render();
    } else if (data.type === 'inkloop:sent') {
      resetSendButton();
      setStatus('Sent.', 'success');
      fetchHistory();
    } else if (data.type === 'inkloop:send-error') {
      resetSendButton();
      setStatus('Failed to send: ' + data.message, 'error');
    } else if (data.type === 'inkloop:scroll') {
      lastScrollY = data.scrollY || 0;
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

  render();
  fetchHistory();
})();
</script>
</body>
</html>
`;
}
