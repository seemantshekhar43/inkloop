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
  assert.doesNotMatch(html, /composer\.addEventListener\('keydown'/);
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

void test("different hashes render distinct, non-colliding shells", () => {
  const other = "b".repeat(16);
  const htmlA = renderReviewShell(HASH);
  const htmlB = renderReviewShell(other);
  assert.match(htmlA, new RegExp(HASH));
  assert.doesNotMatch(htmlA, new RegExp(other));
  assert.match(htmlB, new RegExp(other));
});
