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
  assert.match(html, /pickingHint\.classList\.toggle\('visible', picking\)/);
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
  assert.match(html, /window\.confirm\(/);
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

void test("different hashes render distinct, non-colliding shells", () => {
  const other = "b".repeat(16);
  const htmlA = renderReviewShell(HASH);
  const htmlB = renderReviewShell(other);
  assert.match(htmlA, new RegExp(HASH));
  assert.doesNotMatch(htmlA, new RegExp(other));
  assert.match(htmlB, new RegExp(other));
});
