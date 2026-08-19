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

void test("issue #54: picking mode is not turned off when an element is picked", () => {
  // The element-picker click handler used to call setPickingElement(false) unconditionally as
  // soon as any element was clicked, forcing a re-toggle before every additional pick. It must
  // no longer do so — only the explicit toggle message handler should call setPickingElement.
  const guardPattern = /if \(!pickingElement \|\| pendingTarget\)\s*\n?\s*return;/;
  const clickHandlerStart = sdkSource.search(guardPattern);
  assert.ok(clickHandlerStart >= 0, "expected the picker click handler's combined guard");
  const clickHandlerEnd = sdkSource.indexOf("showComposerAt(", clickHandlerStart);
  const clickHandlerBody = sdkSource.slice(clickHandlerStart, clickHandlerEnd);
  assert.doesNotMatch(clickHandlerBody, /setPickingElement\(false\)/);
});

void test("issue #62: hover-highlight and click-pick exclude <body>/<html> so the highlight clears over empty space", () => {
  // isUnpickable() must exist and treat document.body/document.documentElement as unpickable, and
  // both the mousemove hover-highlight handler and the click-to-pick handler must gate on it —
  // otherwise the cursor moving into empty space (below the artifact's real content, in the
  // wrapper's padding, etc.) leaves the highlight pinned to the page's outer wrapper instead of
  // clearing.
  assert.match(
    sdkSource,
    /function isUnpickable\(el\) \{\s*\n?\s*return el === document\.body \|\| el === document\.documentElement;/,
  );
  const guardOccurrences = sdkSource.match(/isSdkNode\(target\) \|\| isUnpickable\(target\)/g);
  assert.ok(
    guardOccurrences && guardOccurrences.length >= 2,
    "expected isUnpickable to gate both the mousemove and click handlers",
  );
});

void test("issue #64: the composer popup is widened to 392px and its position clamp keeps it on-screen", () => {
  // Widened ~1.4x (280px -> 392px, issue #64); the horizontal position clamp uses innerWidth-408
  // to keep the wider popup's right edge from ever running off-screen (392px width + 16px margin).
  assert.match(sdkSource, /max-width:\s*392px/);
  assert.match(sdkSource, /window\.innerWidth - 408/);
});

void test("issue #54: hover-highlight and re-picking are suspended while the composer is open", () => {
  // Both the mousemove hover-highlight and the click-to-pick handler must skip while a prior
  // pick's composer is still open (pendingTarget set), otherwise picking mode staying on would
  // let the mouse drag the pinned highlight around or let a stray click re-pick underneath the
  // open composer.
  const guardOccurrences = sdkSource.match(
    /if \(!pickingElement \|\| pendingTarget\)\s*\n?\s*return;/g,
  );
  assert.ok(guardOccurrences && guardOccurrences.length >= 2);
});

void test("issue #42 follow-up: the pick cursor is a custom comment-bubble glyph, not the OS crosshair, with a crosshair fallback", () => {
  assert.match(sdkSource, /const PICK_CURSOR_SVG =/);
  // Falls back to "crosshair" (not e.g. "auto") for browsers that reject the custom cursor image.
  assert.match(sdkSource, /const PICK_CURSOR = `url\("data:image\/svg\+xml,[^`]+"\) \d+ \d+, crosshair`;/);
  assert.match(sdkSource, /document\.documentElement\.style\.cursor = value \? PICK_CURSOR : "";/);
});

void test("no-mistakes(review): the pick cursor's hotspot lands on the tip of the bubble's tail, not the bubble body", () => {
  // The SVG path's tail tip is the "M4 3.5 L4 15 L8.2 15 L11 19 L11 15 ..." vertex at (11, 19) -
  // the same "this corner is where the click lands" convention comment-cursor patterns elsewhere
  // (Figma, Notion) use. The cursor's own hotspot offset (the two numbers before ", crosshair")
  // must match that vertex, not some other point on the glyph (e.g. its top-left origin).
  const svgMatch = sdkSource.match(/const PICK_CURSOR_SVG =([\s\S]*?);\s*\n\s*const PICK_CURSOR/);
  assert.ok(svgMatch, "expected to find the PICK_CURSOR_SVG declaration");
  const [, svgBody] = svgMatch;
  assert.ok(svgBody, "expected a captured PICK_CURSOR_SVG body");
  const tailTipMatch = svgBody.match(/L(\d+(?:\.\d+)?) (\d+(?:\.\d+)?) L\1 \d/);
  assert.ok(tailTipMatch, "expected to find the tail-tip vertex in the SVG path data");
  const [, tailTipX, tailTipY] = tailTipMatch;

  const hotspotMatch = sdkSource.match(/PICK_CURSOR_SVG\)}"\) (\d+) (\d+), crosshair`;/);
  assert.ok(hotspotMatch, "expected to find the cursor hotspot offset");
  const [, hotspotX, hotspotY] = hotspotMatch;

  assert.equal(hotspotX, tailTipX, "cursor hotspot x should match the bubble tail tip");
  assert.equal(hotspotY, tailTipY, "cursor hotspot y should match the bubble tail tip");
});

void test("send-error echoes the SDK's own current queue back to the shell", () => {
  // The shell's optimistic-send rollback restores `items` from this message, not from its own
  // pre-fold snapshot - so a POST /feedback failure must hand back the queue's true state
  // (including any note folded in via 'inkloop:add-comment' just before the failed send)
  // instead of leaving the shell to guess from state that predates the fold-in.
  const sendErrorIndex = sdkSource.indexOf('type: "inkloop:send-error"');
  assert.ok(sendErrorIndex >= 0);
  const messageEnd = sdkSource.indexOf('});', sendErrorIndex);
  const messageBody = sdkSource.slice(sendErrorIndex, messageEnd);
  assert.match(messageBody, /items:\s*queue/);
});

void test("issue #73: suggestions never trigger a network call, agent-embedded or heuristic", () => {
  // The deliberate decision from the issue's open question: no inkloop-side LLM call for this,
  // in either tier - not the agent-embedded read, not the DOM-heuristic fallback.
  assert.match(sdkSource, /function computeSuggestions/);
  assert.match(sdkSource, /function readEmbeddedSuggestions/);
  assert.match(sdkSource, /function computeHeuristicSuggestions/);
  for (const fnName of ["computeSuggestions", "readEmbeddedSuggestions", "computeHeuristicSuggestions"]) {
    const fnStart = sdkSource.indexOf(`function ${fnName}`);
    const fnEnd = sdkSource.indexOf("\n  }", fnStart);
    const fnBody = sdkSource.slice(fnStart, fnEnd);
    assert.doesNotMatch(fnBody, /fetch\(/, `expected ${fnName} not to call fetch()`);
  }
});

void test("issue #73: agent-embedded suggestions (read from the artifact's own DOM) take priority over the heuristic fallback", () => {
  // Matches the AGENTS.md-documented convention: a <script type="application/json"
  // id="inkloop-suggestions"> tag any artifact can include on its own, inert to a browser that
  // doesn't know to look for it - same "no inkloop support needed" pattern as the Mermaid example.
  assert.match(sdkSource, /document\.getElementById\("inkloop-suggestions"\)/);
  assert.match(sdkSource, /JSON\.parse\(el\.textContent/);
  assert.match(
    sdkSource,
    /function computeSuggestions\(\)[\s\S]*?return readEmbeddedSuggestions\(\) \?\? computeHeuristicSuggestions\(\);/,
  );
});

void test("issue #73: embedded suggestions are validated and capped before use", () => {
  const fnStart = sdkSource.indexOf("function readEmbeddedSuggestions");
  const fnEnd = sdkSource.indexOf("\n  }", fnStart);
  const fnBody = sdkSource.slice(fnStart, fnEnd);
  // Malformed JSON, a non-array, or non-string entries must not reach the review shell as-is.
  assert.match(fnBody, /catch/);
  assert.match(fnBody, /Array\.isArray\(parsed\)/);
  assert.match(fnBody, /typeof item === "string"/);
  assert.match(fnBody, /slice\(0, MAX_SUGGESTIONS\)/);
});

void test("issue #73: suggestions are posted to the parent before inkloop:ready", () => {
  const suggestionsIndex = sdkSource.indexOf('type: "inkloop:suggestions"');
  const readyIndex = sdkSource.indexOf('type: "inkloop:ready"');
  assert.ok(suggestionsIndex >= 0, "expected an inkloop:suggestions message");
  assert.ok(readyIndex >= 0, "expected an inkloop:ready message");
  assert.ok(
    suggestionsIndex < readyIndex,
    "suggestions should be posted no later than the ready signal that reveals them",
  );
  assert.match(sdkSource, /prompts:\s*computeSuggestions\(\)/);
});

void test("issue #73: the heuristic fallback looks for headings, missing alt text, forms, and long paragraphs", () => {
  const fnStart = sdkSource.indexOf("function computeHeuristicSuggestions");
  const fnEnd = sdkSource.indexOf("\n  }", fnStart);
  const fnBody = sdkSource.slice(fnStart, fnEnd);
  assert.match(fnBody, /querySelectorAll\("h1, h2, h3"\)/);
  assert.match(fnBody, /querySelectorAll\("img"\)/);
  assert.match(fnBody, /getAttribute\("alt"\)/);
  assert.match(fnBody, /querySelectorAll\("form"\)/);
  assert.match(fnBody, /querySelectorAll\("p"\)/);
  // Caps out at MAX_SUGGESTIONS so the shell never has to truncate a longer list itself.
  assert.match(fnBody, /suggestions\.slice\(0, MAX_SUGGESTIONS\)/);
});
