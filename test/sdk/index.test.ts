import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The SDK (src/sdk/index.ts) is a self-contained, zero-import browser IIFE that references
// `window`/`document`/`crypto` at module load time (see its own top-of-file comment) — it can't
// be `import`ed under Node's test runner without a DOM. Matching review-shell.test.ts's existing
// convention of asserting against generated source text rather than executing it, these tests
// read the compiled output and check for the specific guard each issue depends on, so a future
// edit that accidentally drops the guard fails a test instead of only showing up manually.
const sdkSource = readFileSync(
  fileURLToPath(new URL("../../dist/sdk/index.js", import.meta.url)),
  "utf8",
);

void test("issue #37: link clicks inside the artifact are always prevented, not just while picking", () => {
  // The always-on listener (added ahead of the picking-mode-gated one) must call preventDefault
  // on any click whose target is inside an <a href>, regardless of pickingElement — otherwise a
  // reviewer clicking/selecting an ordinary artifact link navigates the whole review iframe away.
  assert.match(sdkSource, /target\.closest\("a\[href\]"\)/);
  assert.match(sdkSource, /if \(target\.closest\("a\[href\]"\)\)\s*\n?\s*event\.preventDefault\(\);/);
});

void test("issue #37: the link-navigation guard is registered before the element-picker click handler", () => {
  const linkGuardIndex = sdkSource.indexOf('target.closest("a[href]")');
  assert.ok(linkGuardIndex >= 0, "expected the link-navigation guard to be present");
  // The mousemove hover-highlight handler also gates on `!pickingElement` earlier in the file —
  // search from the link guard onward so this only finds the *click* handler's own gate.
  const pickerHandlerIndex = sdkSource.indexOf("!pickingElement", linkGuardIndex);
  assert.ok(pickerHandlerIndex >= 0, "expected the element-picker click handler to be present");
  assert.ok(
    linkGuardIndex < pickerHandlerIndex,
    "link-navigation guard must run before the picker handler so both listeners see the click",
  );
});

void test("issue #41: the composer textarea auto-grows with content up to a capped max-height", () => {
  // `resize: none` plus the max-height/overflow pairing is what turns the textarea from a
  // fixed-size scrolling box into one that grows with content and then scrolls internally past
  // the cap, so a future edit reverting any one of these regresses the fix silently.
  assert.match(sdkSource, /max-height:\s*200px/);
  assert.match(sdkSource, /overflow-y:\s*auto/);
  assert.match(sdkSource, /resize:\s*none/);
  assert.match(sdkSource, /textarea\.addEventListener\("input",\s*autoGrowTextarea\)/);
});

void test("issue #41: the composer re-clamps its own position so growth can't push it off-screen", () => {
  // autoGrowTextarea must reset height to "auto" before reading scrollHeight (so it can shrink
  // back down, not just grow) and must re-check the composer's own bounding box against
  // window.innerHeight, since it's positioned near the click point with only a static estimate.
  assert.match(sdkSource, /textarea\.style\.height = "auto"/);
  assert.match(sdkSource, /textarea\.style\.height = `\$\{textarea\.scrollHeight\}px`/);
  assert.match(sdkSource, /window\.innerHeight - composer\.getBoundingClientRect\(\)\.height/);
});
