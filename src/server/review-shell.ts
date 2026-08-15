/**
 * The review UI shell (issue #6): the browser-side page a human actually uses, hosting the
 * artifact iframe plus the annotation composer and queue thread around it.
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
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    background: var(--ink-bg); color: var(--ink-text);
  }
  body { display: flex; flex-direction: column; }
  header {
    flex: 0 0 auto; display: flex; align-items: center; gap: 12px;
    padding: 10px 16px; border-bottom: 1px solid var(--ink-border); background: var(--ink-panel);
  }
  .wordmark { font-weight: 700; letter-spacing: 0.02em; }
  .wordmark::before { content: "⌁ "; color: var(--ink-accent); }
  .session-path {
    flex: 1; color: var(--ink-dim); font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  button.pick {
    appearance: none; border: 1px solid var(--ink-border); background: transparent;
    color: var(--ink-text); padding: 6px 12px; border-radius: 6px; font: inherit; cursor: pointer;
  }
  button.pick.active { background: var(--ink-accent); border-color: var(--ink-accent); color: var(--ink-accent-text); }
  main { flex: 1 1 auto; position: relative; min-height: 0; }
  iframe { border: 0; width: 100%; height: 100%; display: block; background: #fff; }
  footer {
    flex: 0 0 auto; display: flex; flex-direction: column; max-height: 40vh;
    border-top: 1px solid var(--ink-border); background: var(--ink-panel);
  }
  .thread { display: flex; gap: 8px; overflow-x: auto; padding: 10px 16px; }
  .thread-empty { color: var(--ink-dim); font-size: 12px; padding: 2px 0; }
  .pill {
    flex: 0 0 auto; max-width: 260px; border: 1px solid var(--ink-border); border-radius: 8px;
    padding: 8px 10px; background: #1a1a22; font-size: 12px; line-height: 1.4;
  }
  .pill .pill-target {
    color: var(--ink-accent); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.05em; margin-bottom: 4px;
  }
  .pill .pill-comment { color: var(--ink-text); white-space: normal; word-break: break-word; }
  .composer-row { display: flex; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--ink-border); }
  .composer-row textarea {
    flex: 1; resize: vertical; min-height: 36px; max-height: 120px;
    background: #101014; color: var(--ink-text); border: 1px solid var(--ink-border);
    border-radius: 6px; padding: 8px; font: inherit;
  }
  .composer-row button {
    appearance: none; border: 0; border-radius: 6px; padding: 0 16px; font: inherit;
    cursor: pointer; background: var(--ink-accent); color: var(--ink-accent-text);
  }
  .composer-row button:disabled { opacity: 0.4; cursor: default; }
  .status { font-size: 11px; color: var(--ink-dim); padding: 0 16px 8px; min-height: 14px; }
</style>
</head>
<body>
<header>
  <span class="wordmark">inkloop</span>
  <span class="session-path">session ${hash}</span>
  <button type="button" class="pick" id="pick-btn">Pick element</button>
</header>
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
  var thread = document.getElementById('thread');
  var composer = document.getElementById('composer');
  var sendBtn = document.getElementById('send-btn');
  var statusEl = document.getElementById('status');
  var picking = false;
  var items = [];

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

  function render() {
    if (items.length === 0) {
      thread.innerHTML = '<div class="thread-empty">No annotations queued yet — select an element, select text, or write a note below.</div>';
    } else {
      thread.innerHTML = items.map(function (item) {
        var quote = item.target && item.target.quote
          ? '“' + escapeHtml(String(item.target.quote).slice(0, 60)) + '” — '
          : '';
        return '<div class="pill"><div class="pill-target">' + targetLabel(item.target) + '</div>'
          + '<div class="pill-comment">' + quote + escapeHtml(item.comment) + '</div></div>';
      }).join('');
    }
    sendBtn.disabled = items.length === 0;
  }

  function postToFrame(message) {
    if (!iframe.contentWindow) return;
    iframe.contentWindow.postMessage(message, window.location.origin);
  }

  pickBtn.addEventListener('click', function () {
    picking = !picking;
    pickBtn.classList.toggle('active', picking);
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

  sendBtn.addEventListener('click', function () {
    postToFrame({ type: 'inkloop:send' });
  });

  window.addEventListener('message', function (event) {
    if (event.source !== iframe.contentWindow || event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data.source !== 'inkloop-sdk') return;

    if (data.type === 'inkloop:queue') {
      items = data.items || [];
      render();
      statusEl.textContent = '';
    } else if (data.type === 'inkloop:sent') {
      statusEl.textContent = 'Sent.';
    } else if (data.type === 'inkloop:send-error') {
      statusEl.textContent = 'Failed to send: ' + data.message;
    }
  });

  render();
})();
</script>
</body>
</html>
`;
}
