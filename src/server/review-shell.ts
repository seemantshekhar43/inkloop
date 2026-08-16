/**
 * The review UI shell (issue #6, polished in #18): the browser-side page a human actually uses,
 * hosting the artifact iframe plus the annotation composer and queue thread around it.
 *
 * Deliberately not a right-hand comment sidebar — the layout AGENTS.md's "visual novelty"
 * non-negotiable rules out as the generic pattern this space already has (lavish-axi,
 * sidenote-cli, Percy/Chromatic reviewers all read as some variant of it). Instead the artifact
 * keeps the full viewport width and a bottom dock holds a horizontally-scrolling annotation
 * thread plus the free-text composer, so review chrome never competes with the artifact for
 * horizontal space the way a sidebar does.
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
    --ink-accent-text: #ffffff;
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
    font: inherit; cursor: pointer; transition: background-color 0.12s ease, border-color 0.12s ease;
  }
  button.pick:hover { border-color: var(--ink-accent); }
  button.pick.active { background: var(--ink-accent); border-color: var(--ink-accent); color: var(--ink-accent-text); }
  .picking-hint {
    flex: 0 0 auto; display: none; align-items: center;
    padding: var(--space-2) var(--space-4); font-size: 12px; color: var(--ink-accent-text);
    background: var(--ink-accent); border-bottom: 1px solid var(--ink-border);
  }
  .picking-hint.visible { display: flex; }
  main { flex: 1 1 auto; position: relative; min-height: 0; }
  iframe { border: 0; width: 100%; height: 100%; display: block; background: #fff; }
  footer {
    flex: 0 0 auto; display: flex; flex-direction: column; max-height: 40vh;
    border-top: 1px solid var(--ink-border); background: var(--ink-panel);
  }
  .thread { display: flex; gap: var(--space-2); overflow-x: auto; padding: var(--space-3) var(--space-4); }
  .thread-empty { color: var(--ink-dim); font-size: 12px; padding: var(--space-1) 0; }
  .thread-empty::before { content: "› "; color: var(--ink-accent); }
  .pill {
    position: relative; flex: 0 0 auto; max-width: 260px; min-width: 120px;
    border: 1px solid var(--ink-border); border-radius: 8px;
    padding: var(--space-2) var(--space-3); padding-right: 26px;
    background: #1a1a22; font-size: 12px; line-height: 1.4;
    transition: border-color 0.12s ease;
  }
  .pill:hover { border-color: var(--ink-accent); }
  .pill .pill-target {
    color: var(--ink-accent); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.05em; margin-bottom: var(--space-1);
  }
  .pill .pill-comment { color: var(--ink-text); white-space: normal; word-break: break-word; }
  .pill-remove {
    position: absolute; top: 4px; right: 4px; width: 18px; height: 18px;
    appearance: none; border: 0; border-radius: 4px; background: transparent;
    color: var(--ink-dim); font: inherit; line-height: 1; cursor: pointer;
  }
  .pill-remove:hover { background: var(--ink-border); color: var(--ink-text); }
  .composer-row { display: flex; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--ink-border); }
  .composer-row textarea {
    flex: 1; resize: vertical; min-height: 36px; max-height: 120px;
    background: #101014; color: var(--ink-text); border: 1px solid var(--ink-border);
    border-radius: 6px; padding: var(--space-2); font: inherit;
  }
  .composer-row textarea:focus { outline: none; border-color: var(--ink-accent); }
  .composer-row button {
    appearance: none; border: 0; border-radius: 6px; padding: 0 var(--space-4); font: inherit;
    cursor: pointer; background: var(--ink-accent); color: var(--ink-accent-text);
    transition: opacity 0.12s ease;
  }
  .composer-row button:disabled { opacity: 0.4; cursor: default; }
  .composer-row button.sending { opacity: 0.7; cursor: progress; }
  .status { font-size: 11px; color: var(--ink-dim); padding: 0 var(--space-4) var(--space-2); min-height: 14px; }
  .status.success { color: var(--ink-success); }
  .status.error { color: var(--ink-error); }

  @media (max-width: 480px) {
    footer { max-height: 55vh; }
    .pill { max-width: 200px; }
    .composer-row { flex-direction: column; }
    .composer-row button { align-self: flex-end; }
  }
</style>
</head>
<body>
<header>
  <span class="wordmark">inkloop</span>
  <span class="session-path">session ${hash}</span>
  <button type="button" class="pick" id="pick-btn">Select element</button>
</header>
<div class="picking-hint" id="picking-hint">Click an element in the artifact to annotate it — click “Select element” again to cancel.</div>
<main>
  <iframe id="artifact-frame" src="/session/${hash}/artifact" title="artifact preview"></iframe>
</main>
<footer>
  <div class="thread" id="thread">
    <div class="thread-empty">No annotations queued yet — select an element, select text, or write a note below.</div>
  </div>
  <div class="composer-row">
    <textarea id="composer" placeholder="Write a note… (not tied to a specific element)"></textarea>
    <button type="button" id="send-btn" disabled>Send</button>
  </div>
  <div class="status" id="status"></div>
</footer>
<script>
(function () {
  var iframe = document.getElementById('artifact-frame');
  var pickBtn = document.getElementById('pick-btn');
  var pickingHint = document.getElementById('picking-hint');
  var thread = document.getElementById('thread');
  var composer = document.getElementById('composer');
  var sendBtn = document.getElementById('send-btn');
  var statusEl = document.getElementById('status');
  var picking = false;
  var items = [];
  var lastScrollY = 0;
  var SESSION_HASH = ${JSON.stringify(hash)};

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function targetLabel(target) {
    if (!target) return 'note';
    if (target.kind === 'element') return 'element';
    if (target.kind === 'text-range') return 'selection';
    return 'note';
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
  }

  function postToFrame(message) {
    if (!iframe.contentWindow) return;
    iframe.contentWindow.postMessage(message, window.location.origin);
  }

  function setPicking(value) {
    picking = value;
    pickBtn.classList.toggle('active', picking);
    pickingHint.classList.toggle('visible', picking);
  }

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
    fetch('/session/' + SESSION_HASH + '/reload?since=' + sinceVersion)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var version = data.version || 0;
        if (version > sinceVersion) {
          iframe.src = '/session/' + SESSION_HASH + '/artifact?v=' + version;
        }
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
})();
</script>
</body>
</html>
`;
}
