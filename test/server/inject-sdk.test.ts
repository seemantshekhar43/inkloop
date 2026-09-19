import { test } from "node:test";
import assert from "node:assert/strict";
import { injectSdkScript } from "../../src/server/inject-sdk.js";

void test("inserts the SDK script tag just before the closing </body>", () => {
  const out = injectSdkScript("<html><body><p>hi</p></body></html>");
  assert.equal(out, '<html><body><p>hi</p><script src="/sdk.js"></script></body></html>');
});

void test("appends the SDK script tag when there is no </body> at all", () => {
  const out = injectSdkScript("<p>bare fragment</p>");
  assert.equal(out, '<p>bare fragment</p>\n<script src="/sdk.js"></script>\n');
});

void test("injects before the real closing tag, not an earlier literal '</body>' in the markup", () => {
  // Regression: an artifact's own comment or displayed text can legitimately contain the
  // substring "</body>" (documenting HTML, say) before the actual closing tag. A first-match
  // replace would splice the script tag into that earlier occurrence, where it never executes.
  const html = "<html><!-- inserted before </body> --><body><p>hi</p></body></html>";
  const out = injectSdkScript(html);
  assert.equal(
    out,
    '<html><!-- inserted before </body> --><body><p>hi</p><script src="/sdk.js"></script></body></html>',
  );
});

void test("handles a closing tag with internal whitespace", () => {
  const out = injectSdkScript("<body><p>hi</p></body  >");
  assert.equal(out, '<body><p>hi</p><script src="/sdk.js"></script></body  >');
});
