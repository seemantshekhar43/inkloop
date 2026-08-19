import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReviewShell } from "../../src/server/review-shell.js";

const HASH = "a".repeat(16);

void test("renders an iframe pointed at the session's artifact route", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, new RegExp(`<iframe id="artifact-frame" src="/session/${HASH}/artifact"`));
});

void test("renders the annotation composer and a disabled Send button with an empty queue", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /<textarea id="composer"/);
  assert.match(html, /<button type="button" id="send-btn" disabled>Send<\/button>/);
  assert.match(html, /No annotations queued yet/);
});

void test("renders the element-picker toggle button", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /<button type="button" class="pick" id="pick-btn" aria-pressed="false">/);
  assert.match(html, /<span id="pick-label">Sidenote<\/span>/);
});

void test("wires up the postMessage bridge to the SDK's message vocabulary", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /inkloop:toggle-element-picker/);
  assert.match(html, /inkloop:add-comment/);
  assert.match(html, /inkloop:send/);
  assert.match(html, /inkloop:remove/);
  assert.match(html, /inkloop:queue/);
  assert.match(html, /inkloop:sent/);
  assert.match(html, /inkloop:send-error/);
  // Same-origin restriction on both directions of the bridge, matching the SDK's own posture.
  assert.match(html, /window\.location\.origin/);
  assert.match(html, /event\.origin !== window\.location\.origin/);
});

void test("renders a remove control per pill, delegated from the thread container (issue #18)", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /class="pill-remove"/);
  assert.match(html, /thread\.addEventListener\('click'/);
});

void test("Send enters a distinct in-flight state and resets on sent/error (issue #18)", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /classList\.add\('sending'\)/);
  assert.match(html, /Sending…/);
  assert.match(html, /function resetSendButton/);
});

void test("shows a picking-mode hint that toggles with the element picker (issue #18)", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /id="picking-hint"/);
  assert.match(html, /pickingHint\.classList\.add\('visible'\)/);
  assert.match(html, /pickingHint\.classList\.remove\('visible'\)/);
});

void test("issue #61: the picking-mode hint auto-hides after a few seconds instead of staying up the whole time", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /var PICKING_HINT_VISIBLE_MS = 4000;/);
  assert.match(html, /var PICKING_HINT_FADE_MS = 300;/);
  // The auto-hide timer must be cleared whenever picking is re-toggled (on or off), so a rapid
  // toggle-off-then-on doesn't leave a stale timer hiding the banner out from under a fresh
  // activation, or a stale fade class stuck on from a cancelled fade.
  assert.match(html, /clearTimeout\(pickingHintTimer\)/);
  assert.match(html, /clearTimeout\(pickingHintFadeTimer\)/);
  assert.match(html, /pickingHint\.classList\.remove\('fading'\)/);
  assert.match(html, /pickingHint\.classList\.add\('fading'\)/);
});

void test("picking state is driven by the SDK's own inkloop:picking message, not guessed locally (issue #18)", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /data\.type === 'inkloop:picking'/);
  assert.match(html, /setPicking\(Boolean\(data\.active\)\)/);
});

void test("escapes untrusted queue content before interpolating it into pill markup", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /function escapeHtml/);
  // Both the free-form comment and the anchored quote go through escaping before being joined
  // into innerHTML — queue items ultimately originate from page content the SDK captured.
  assert.match(html, /escapeHtml\(item\.comment\)/);
  assert.match(html, /escapeHtml\(String\(item\.target\.quote\)/);
});

void test("issue #38: the round/comment label reflects the live queue, not just sent history", () => {
  const html = renderReviewShell(HASH);
  // updateHistoryLabel must exist and be the sole writer of historyLabel's text, combining the
  // last-fetched sent-round counts with however many items are currently queued but unsent — the
  // bug was that the label only ever reflected server-fetched history, so it read
  // "0 rounds · 0 comments" the entire time annotations sat queued in the composer.
  assert.match(html, /function updateHistoryLabel/);
  assert.match(html, /items\.length > 0/);
  assert.match(html, /items\.length \+ ' queued'/);
  // render() (called on every SDK inkloop:queue message, i.e. every queue change) must refresh
  // the label too, not just renderHistory() after a send.
  const renderFnMatch = html.match(/function render\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(renderFnMatch, "expected to find render()'s body");
  assert.match(renderFnMatch[0], /updateHistoryLabel\(\);/);
});

void test("live reload (issue #8): long-polls /reload, reloads the iframe on a version bump, and restores draft state on inkloop:ready", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, new RegExp(`SESSION_HASH = ${JSON.stringify(HASH)}`));
  assert.match(html, /\/session\/' \+ SESSION_HASH \+ '\/reload\?since=/);
  assert.match(html, /\/session\/' \+ SESSION_HASH \+ '\/artifact\?v=/);
  assert.match(html, /function pollReload/);
  // Fires on every inkloop:ready — including the iframe's very first load, not just reloads —
  // handing the fresh SDK instance back its unsent queue and last-known scroll position.
  assert.match(html, /data\.type === 'inkloop:ready'/);
  assert.match(html, /type: 'inkloop:restore-draft', queue: items, scrollY: lastScrollY/);
  assert.match(html, /data\.type === 'inkloop:scroll'/);
});

void test("session lifecycle (issue #9): renders an End session control, confirms before ending, and disables interactions once ended", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /<button type="button" class="end-session" id="end-btn">End session<\/button>/);
  assert.match(html, /id="ended-banner"/);
  assert.match(html, new RegExp(`fetch\\('/session/' \\+ SESSION_HASH \\+ '/end'`));
  assert.match(html, /function markEnded/);
  assert.match(html, /pickBtn\.disabled = true/);
  assert.match(html, /sendBtn\.disabled = true/);
  assert.match(html, /composer\.disabled = true/);
  // Live reload polling stops once ended — no point watching a file for a session no longer
  // under review.
  assert.match(html, /reloadPollingActive = false/);
  assert.match(html, /if \(!reloadPollingActive\) return;/);
});

void test("issue #59: End-session confirmation uses a themed in-app modal, not window.confirm()", () => {
  const html = renderReviewShell(HASH);
  // Matches an actual invocation, e.g. window.confirm('...'), not this test's or the source's own
  // prose mentioning "window.confirm()" while explaining what it replaced.
  assert.doesNotMatch(html, /window\.confirm\(['"]/);
  assert.match(html, /<div class="modal-overlay" id="end-modal-overlay">/);
  assert.match(html, /id="end-modal-cancel"/);
  assert.match(html, /id="end-modal-confirm"/);
  assert.match(html, /function showEndModal/);
  assert.match(html, /function hideEndModal/);
  // Confirming in the modal is what actually calls the /end endpoint, cancelling must not.
  assert.match(
    html,
    /endModalConfirm\.addEventListener\('click', function \(\) \{[\s\S]*?fetch\('\/session\/' \+ SESSION_HASH \+ '\/end'/,
  );
});

void test("issue #60: typing in the composer alone (nothing queued) enables Send", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /composer\.value\.trim\(\)\.length === 0/);
  assert.match(html, /composer\.addEventListener\('input', updateSendButtonEnabled\)/);
});

void test("issue #60: Send folds the composer's current text into the same batch instead of dropping it", () => {
  const html = renderReviewShell(HASH);
  const sendHandlerStart = html.indexOf("sendBtn.addEventListener('click'");
  assert.ok(sendHandlerStart >= 0);
  const sendHandlerEnd = html.indexOf('});', sendHandlerStart);
  const sendHandlerBody = html.slice(sendHandlerStart, sendHandlerEnd);
  assert.match(sendHandlerBody, /inkloop:add-comment/);
  assert.match(sendHandlerBody, /inkloop:send/);
  // add-comment must be posted before send so the folded note lands in the same batch.
  assert.ok(
    sendHandlerBody.indexOf('inkloop:add-comment') < sendHandlerBody.indexOf('inkloop:send'),
  );
});

void test("issue #60: Enter-to-queue is dropped entirely, not just re-labeled", () => {
  const html = renderReviewShell(HASH);
  assert.doesNotMatch(html, /submitNote/);
});

void test("issue #70: Enter in the composer sends (Shift+Enter still inserts a newline)", () => {
  const html = renderReviewShell(HASH);
  const keydownHandlerStart = html.indexOf("composer.addEventListener('keydown'");
  assert.ok(keydownHandlerStart >= 0);
  const keydownHandlerEnd = html.indexOf('});', keydownHandlerStart);
  const keydownHandlerBody = html.slice(keydownHandlerStart, keydownHandlerEnd);
  // Shift+Enter must bail out before doing anything, leaving the textarea's default newline
  // behavior untouched.
  assert.match(keydownHandlerBody, /event\.key !== 'Enter' \|\| event\.shiftKey\) return;/);
  assert.match(keydownHandlerBody, /event\.preventDefault\(\);/);
  // Delegates to the Send button's own click handler (and its disabled guard) rather than
  // duplicating the send logic.
  assert.match(keydownHandlerBody, /sendBtn\.click\(\);/);
});

void test("issue #55: the picking-mode label reads as a clear call-to-action, not 'Cancel Sidenote'", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /pickLabel\.textContent = picking \? 'Stop Sidenote' : 'Sidenote';/);
  assert.doesNotMatch(html, /Cancel Sidenote/);
});

void test("issue #57: the free-text composer's placeholder names the agent as the recipient", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /placeholder="Write a note to agent…"/);
});

void test("issue #58: the session-ended banner reads as a copyable command", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /Session ended\. Run <code>inkloop &lt;file&gt; --reopen<\/code> to resume review\./);
});

void test("uses the same mono font stack as axi.md's design system, with no webfont network load", () => {
  const html = renderReviewShell(HASH);
  assert.match(
    html,
    /font-family: "JetBrains Mono", "Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace;/,
  );
  // No <link> to a font host and no @font-face rule — the preference is font-family only, so a
  // reviewer without JetBrains Mono/Fira Code installed silently falls through to the original
  // system-monospace stack rather than triggering a network fetch.
  assert.doesNotMatch(html, /@font-face/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

void test("issue #63: Send optimistically clears the thread and paints a pending round before the network call", () => {
  const html = renderReviewShell(HASH);
  const sendHandlerStart = html.indexOf("sendBtn.addEventListener('click'");
  assert.ok(sendHandlerStart >= 0);
  const sendHandlerEnd = html.indexOf('function resetSendButton', sendHandlerStart);
  assert.ok(sendHandlerEnd >= 0);
  const sendHandlerBody = html.slice(sendHandlerStart, sendHandlerEnd);
  // The optimistic clear/backup and the pending-round paint must happen before the
  // 'inkloop:send' postMessage that actually kicks off the POST /feedback round trip.
  assert.match(sendHandlerBody, /pendingSendItems = items;/);
  assert.match(sendHandlerBody, /items = \[\];/);
  assert.match(sendHandlerBody, /renderPendingRound\(itemsBeingSent\);/);
  const clearIndex = sendHandlerBody.indexOf('items = [];');
  const sendPostIndex = sendHandlerBody.indexOf("type: 'inkloop:send'");
  assert.ok(clearIndex >= 0 && sendPostIndex >= 0 && clearIndex < sendPostIndex);
});

void test("issue #63: inkloop:send-error rolls back the optimistic clear and re-renders lastHistory", () => {
  const html = renderReviewShell(HASH);
  const errorHandlerStart = html.indexOf("data.type === 'inkloop:send-error'");
  assert.ok(errorHandlerStart >= 0);
  const errorHandlerEnd = html.indexOf('} else if', errorHandlerStart);
  const errorHandlerBody = html.slice(errorHandlerStart, errorHandlerEnd);
  // Restores from the SDK's own echoed queue (data.items) rather than the pre-fold
  // pendingSendItems snapshot, so a composer note folded in via 'inkloop:add-comment' just
  // before the failed send isn't silently dropped from view.
  assert.match(errorHandlerBody, /items = Array\.isArray\(data\.items\) \? data\.items : pendingSendItems;/);
  assert.match(errorHandlerBody, /pendingSendItems = null;/);
  assert.match(errorHandlerBody, /renderHistory\(lastHistory\);/);
});

void test("issue #63: the SDK's own queue echo during a send in flight doesn't stomp the optimistic clear", () => {
  const html = renderReviewShell(HASH);
  const queueHandlerStart = html.indexOf("data.type === 'inkloop:queue'");
  assert.ok(queueHandlerStart >= 0);
  const queueHandlerEnd = html.indexOf('} else if', queueHandlerStart);
  const queueHandlerBody = html.slice(queueHandlerStart, queueHandlerEnd);
  // Without this guard, the SDK's synchronous notifyQueueChanged() echo from the
  // 'inkloop:add-comment' the Send click just posted would overwrite the optimistic `items = []`
  // with the just-typed note before 'inkloop:sent'/'inkloop:send-error' reconciles it.
  assert.match(queueHandlerBody, /if \(pendingSendItems === null\) \{/);
});

void test("different hashes render distinct, non-colliding shells", () => {
  const other = "b".repeat(16);
  const htmlA = renderReviewShell(HASH);
  const htmlB = renderReviewShell(other);
  assert.match(htmlA, new RegExp(HASH));
  assert.doesNotMatch(htmlA, new RegExp(other));
  assert.match(htmlB, new RegExp(other));
});

void test("issue #42 follow-up: prefers-reduced-motion collapses the entrance/press animations and transitions", () => {
  const html = renderReviewShell(HASH);
  const mediaStart = html.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(mediaStart >= 0, "expected a prefers-reduced-motion media query guarding the new animations");
  const mediaEnd = html.indexOf("</style>", mediaStart);
  const mediaBody = html.slice(mediaStart, mediaEnd);
  // Standard collapse pattern: near-zero durations (not display:none, which would hide content)
  // rather than removing the animation/transition rules outright.
  assert.match(mediaBody, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(mediaBody, /animation-iteration-count:\s*1\s*!important/);
  assert.match(mediaBody, /transition-duration:\s*0\.01ms\s*!important/);
  assert.match(mediaBody, /scroll-behavior:\s*auto\s*!important/);
});

void test("issue #42 follow-up: dark-only color-scheme is declared on :root and matched by a theme-color meta", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /<meta name="theme-color" content="#0b0b0f">/);
  assert.match(html, /:root\s*{[^}]*color-scheme:\s*dark;/s);
});

void test("issue #42 follow-up: the composer textarea has an aria-label since its placeholder alone isn't a reliable accessible name", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /<textarea id="composer"[^>]*aria-label="Note to agent"[^>]*>/);
});

void test("issue #42 follow-up: transient banners and the send status line announce via role=status/aria-live=polite", () => {
  const html = renderReviewShell(HASH);
  for (const id of ["picking-hint", "ended-banner", "tab-banner", "status"]) {
    const re = new RegExp(`id="${id}"[^>]*role="status"[^>]*aria-live="polite"`);
    assert.match(html, re, `expected #${id} to carry role=status aria-live=polite`);
  }
});

void test("issue #42 follow-up: the history panel contains overscroll so scrolling past either end doesn't chain into the page/iframe behind it", () => {
  const html = renderReviewShell(HASH);
  const panelStart = html.indexOf(".history-panel {");
  assert.ok(panelStart >= 0, "expected a .history-panel rule");
  const panelEnd = html.indexOf("}", panelStart);
  const panelBody = html.slice(panelStart, panelEnd);
  assert.match(panelBody, /overscroll-behavior:\s*contain;/);
});

void test("issue #43 follow-up: buttons get real touch targets - no tap delay, no default grey tap-highlight flash", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /button\s*{[^}]*touch-action:\s*manipulation;[^}]*-webkit-tap-highlight-color:\s*transparent;/);
});

void test("issue #73: renders a suggestions container above the composer", () => {
  const html = renderReviewShell(HASH);
  const suggestionsIndex = html.indexOf('id="suggestions"');
  const composerRowIndex = html.indexOf('class="composer-row"');
  assert.ok(suggestionsIndex >= 0, "expected a #suggestions element");
  assert.ok(
    suggestionsIndex < composerRowIndex,
    "suggestions should render above the composer row",
  );
});

void test("issue #73: the SDK's suggestions message is stored and rendered, not auto-shown once history exists", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /data\.type === 'inkloop:suggestions'/);
  assert.match(html, /suggestions = Array\.isArray\(data\.prompts\) \? data\.prompts : \[\];/);
  assert.match(html, /function renderSuggestions/);
  const fnStart = html.indexOf("function renderSuggestions");
  const fnEnd = html.indexOf("\n  }", fnStart);
  const fnBody = html.slice(fnStart, fnEnd);
  // Hidden once the session has any sent rounds, regardless of how many candidates were computed.
  assert.match(fnBody, /var hasHistory = \(lastHistory\.rounds \|\| \[\]\)\.length > 0;/);
  assert.match(fnBody, /if \(hasHistory \|\| suggestions\.length === 0\)/);
  // Re-evaluated from renderHistory (the same trigger lastHistory.rounds updates on), so sending
  // the first round hides the block immediately rather than waiting for the next artifact reload.
  const renderHistoryStart = html.indexOf("function renderHistory");
  const renderHistoryEnd = html.indexOf("\n  }", renderHistoryStart);
  assert.match(html.slice(renderHistoryStart, renderHistoryEnd), /renderSuggestions\(\);/);
});

void test("issue #73: clicking a suggestion populates the composer instead of auto-sending", () => {
  const html = renderReviewShell(HASH);
  const listenerStart = html.indexOf("suggestionsEl.addEventListener('click'");
  assert.ok(listenerStart >= 0, "expected a click listener on the suggestions container");
  const listenerEnd = html.indexOf("});", listenerStart);
  const listenerBody = html.slice(listenerStart, listenerEnd);
  assert.match(listenerBody, /composer\.value = text;/);
  assert.doesNotMatch(listenerBody, /postToFrame\(\{ type: 'inkloop:send' \}\)/);
});

void test("issue #73: a suggestion chip can be individually dismissed", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /class="suggestion-chip-remove"/);
  const listenerStart = html.indexOf("suggestionsEl.addEventListener('click'");
  const listenerEnd = html.indexOf("});", listenerStart);
  const listenerBody = html.slice(listenerStart, listenerEnd);
  assert.match(listenerBody, /suggestions\.splice\(removeIndex, 1\);/);
});

void test("issue #73: sending clears every suggestion immediately, not just once history refreshes", () => {
  const html = renderReviewShell(HASH);
  const sendHandlerStart = html.indexOf("sendBtn.addEventListener('click'");
  const sendCallText = "postToFrame({ type: 'inkloop:send' });";
  const sendCallIndex = html.indexOf(sendCallText, sendHandlerStart);
  const sendHandlerEnd = html.indexOf("});", sendCallIndex + sendCallText.length);
  const sendHandlerBody = html.slice(sendHandlerStart, sendHandlerEnd);
  assert.match(sendHandlerBody, /suggestions = \[\];/);
  assert.match(sendHandlerBody, /renderSuggestions\(\);/);
  // Must clear suggestions before the optimistic-send items are cleared/rendered ends and the
  // network call is kicked off - not deferred to the async 'inkloop:sent'/history refresh path.
  assert.ok(
    sendHandlerBody.indexOf("suggestions = [];") < sendCallIndex - sendHandlerStart,
    "suggestions should clear synchronously within the click handler, before the send is posted",
  );
});

void test("issue #76: a round-history entry carries a status derived from deliveredAt/reply, not just its own existence", () => {
  const html = renderReviewShell(HASH);
  const statusFnMatch = html.match(/function roundStatus\(round\) \{[\s\S]*?\n {2}\}/);
  assert.ok(statusFnMatch, "expected to find roundStatus()");
  const body = statusFnMatch[0];
  // Reply present -> revised, regardless of delivery state.
  assert.match(body, /if \(round\.reply\) return \{ key: 'revised', label: 'Revised' \};/);
  // No reply, but every item has deliveredAt -> agent has it (a rotating verb, not a fixed label).
  assert.match(body, /allDelivered = roundItems\.length > 0 && roundItems\.every/);
  assert.match(body, /item\.deliveredAt/);
  assert.match(body, /key: 'delivered'/);
  // Anything else (nothing delivered yet, or only some items delivered) -> queued.
  assert.match(body, /return \{ key: 'queued', label: 'Queued' \};/);
});

void test("issue #76: the round label renders a status pill wired to roundHtml's pending/roundStatus branches", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /class="history-round-status status-' \+ status\.key \+ '"/);
  const roundHtmlMatch = html.match(/function roundHtml\(round, pending\) \{[\s\S]*?\n {2}\}/);
  assert.ok(roundHtmlMatch, "expected to find roundHtml()");
  assert.match(
    roundHtmlMatch[0],
    /var status = pending \? \{ key: 'sending', label: 'Sending…' \} : roundStatus\(round\);/,
  );
});

void test("issue #76: the working-status verb bank is single-word and rotates deterministically by round number", () => {
  const html = renderReviewShell(HASH);
  const verbsMatch = html.match(/var WORKING_VERBS = \[([\s\S]*?)\];/);
  assert.ok(verbsMatch, "expected to find WORKING_VERBS");
  const verbs = (verbsMatch?.[1] ?? "").match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
  assert.ok(verbs.length > 0, "expected at least one working verb");
  for (const verb of verbs) {
    assert.doesNotMatch(verb, /\s/, `expected "${verb}" to be a single word`);
  }
  // Deterministic per round (round.round % verbs.length), not Math.random() - a re-render of the
  // same round must not flicker to a different verb.
  assert.match(html, /WORKING_VERBS\[round\.round % WORKING_VERBS\.length\]/);
});

void test("issue #78: renderHistory follows new content to the bottom only when the reviewer was already near it, otherwise restores their exact scroll position", () => {
  const html = renderReviewShell(HASH);
  const renderHistoryMatch = html.match(/function renderHistory\(history\) \{[\s\S]*?\n {2}\}/);
  assert.ok(renderHistoryMatch, "expected to find renderHistory()");
  const body = renderHistoryMatch[0];
  // Both captured before the innerHTML rewrite, which tears down the old nodes and doesn't
  // reliably preserve scrollTop on its own (may reset to 0, or land somewhere arbitrary via the
  // browser's scroll-anchoring guessing at a similar node in the new markup).
  const wasNearBottomAt = body.indexOf("var wasNearBottom = isHistoryPanelNearBottom();");
  const prevScrollTopAt = body.indexOf("var prevScrollTop = historyPanel.scrollTop;");
  const innerHtmlAt = body.indexOf("historyPanel.innerHTML = rounds.map");
  assert.ok(wasNearBottomAt >= 0, "expected wasNearBottom to be captured");
  assert.ok(prevScrollTopAt >= 0, "expected prevScrollTop to be captured");
  assert.ok(innerHtmlAt > wasNearBottomAt, "expected the near-bottom check before the innerHTML rewrite");
  assert.ok(innerHtmlAt > prevScrollTopAt, "expected prevScrollTop to be captured before the innerHTML rewrite");
  // Explicitly restored after, rather than left to however the DOM replacement happened to leave it.
  assert.match(body, /historyPanel\.scrollTop = wasNearBottom \? historyPanel\.scrollHeight : prevScrollTop;/);
});

void test("issue #78: the optimistic pending round always scrolls into view (the reviewer just clicked Send)", () => {
  const html = renderReviewShell(HASH);
  const renderPendingMatch = html.match(/function renderPendingRound\(itemsForRound\) \{[\s\S]*?\n {2}\}/);
  assert.ok(renderPendingMatch, "expected to find renderPendingRound()");
  assert.match(renderPendingMatch[0], /scrollHistoryPanelToBottom\(\);/);
});

void test("issue #78: near-bottom detection uses the panel's own scroll metrics with slack, not an exact-zero check", () => {
  const html = renderReviewShell(HASH);
  assert.match(
    html,
    /historyPanel\.scrollHeight - historyPanel\.scrollTop - historyPanel\.clientHeight\s*\n?\s*< HISTORY_SCROLL_BOTTOM_SLACK_PX/,
  );
});

void test("issue #76 follow-up: the status pill is hidden once a round has a reply - the 'Agent' block already says it's done", () => {
  const html = renderReviewShell(HASH);
  const roundHtmlMatch = html.match(/function roundHtml\(round, pending\) \{[\s\S]*?\n {2}\}/);
  assert.ok(roundHtmlMatch, "expected to find roundHtml()");
  assert.match(
    roundHtmlMatch[0],
    /var statusHtml = status\.key === 'revised'\s*\n\s*\? ''/,
  );
});
