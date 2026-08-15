import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReviewShell } from "./review-shell.js";

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
  assert.match(html, /<button type="button" class="pick" id="pick-btn">Pick element<\/button>/);
});

void test("wires up the postMessage bridge to the SDK's message vocabulary", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /inkloop:toggle-element-picker/);
  assert.match(html, /inkloop:add-comment/);
  assert.match(html, /inkloop:send/);
  assert.match(html, /inkloop:queue/);
  assert.match(html, /inkloop:sent/);
  assert.match(html, /inkloop:send-error/);
  // Same-origin restriction on both directions of the bridge, matching the SDK's own posture.
  assert.match(html, /window\.location\.origin/);
  assert.match(html, /event\.origin !== window\.location\.origin/);
});

void test("escapes untrusted queue content before interpolating it into pill markup", () => {
  const html = renderReviewShell(HASH);
  assert.match(html, /function escapeHtml/);
  // Both the free-form comment and the anchored quote go through escaping before being joined
  // into innerHTML — queue items ultimately originate from page content the SDK captured.
  assert.match(html, /escapeHtml\(item\.comment\)/);
  assert.match(html, /escapeHtml\(String\(item\.target\.quote\)/);
});

void test("different hashes render distinct, non-colliding shells", () => {
  const other = "b".repeat(16);
  const htmlA = renderReviewShell(HASH);
  const htmlB = renderReviewShell(other);
  assert.match(htmlA, new RegExp(HASH));
  assert.doesNotMatch(htmlA, new RegExp(other));
  assert.match(htmlB, new RegExp(other));
});
