/**
 * inkloop's injected browser SDK. Served at GET /sdk.js and injected as a <script> tag into the
 * artifact response at serve time only (see server/create-server.ts's injectSdk) — it never
 * touches the artifact file on disk, so opening the saved .html directly renders identically.
 *
 * Deliberately a single file with zero imports, compiled on its own (see sdk/tsconfig.json) so
 * the output is exactly what's authored here: one self-contained IIFE, zero runtime deps, safe
 * to serve byte-for-byte as dist/sdk/index.js. The FeedbackItem/FeedbackTarget shapes below
 * mirror shared/feedback.ts's exactly on purpose (duplicated, not imported, to keep this file
 * self-contained) — keep the two in sync if the wire format changes.
 *
 * All injected UI chrome lives inside a shadow root so it can never collide with the artifact's
 * own styles or scripts (AGENTS.md non-negotiable). The SDK never mutates the artifact's own DOM
 * outside of that shadow host and a transient hover-highlight outline.
 */

(function inkloopSdk() {
  "use strict";

  interface FeedbackTarget {
    kind: "element" | "text-range" | "general";
    selector?: string;
    startOffset?: number;
    endOffset?: number;
    quote?: string;
    fingerprint?: string;
  }

  interface FeedbackItem {
    id: string;
    target: FeedbackTarget;
    comment: string;
    createdAt: string;
    deliveredAt?: string;
    drifted?: boolean;
  }

  // Only makes sense hosted inside the review shell's iframe; guard against accidental direct
  // loads (e.g. someone opening the artifact URL straight in a tab) doing anything.
  if (window === window.parent) return;

  const hashMatch = /^\/session\/([0-9a-f]{16})\/artifact\/?$/.exec(window.location.pathname);
  if (!hashMatch) return;
  const sessionHash = hashMatch[1];

  const queue: FeedbackItem[] = [];

  function postToParent(message: Record<string, unknown>): void {
    window.parent.postMessage({ source: "inkloop-sdk", ...message }, window.location.origin);
  }

  function notifyQueueChanged(): void {
    postToParent({ type: "inkloop:queue", items: queue });
  }

  function makeId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function queueItem(target: FeedbackTarget, comment: string): void {
    const trimmed = comment.trim();
    if (!trimmed) return;
    queue.push({ id: makeId(), target, comment: trimmed, createdAt: new Date().toISOString() });
    notifyQueueChanged();
  }

  /** Removes a queued-but-unsent item by id, requested by the review shell's pill "×" control
   * (issue #18). No-ops silently if the id is already gone (e.g. a stale click after Send). */
  function removeQueueItem(id: string): void {
    const index = queue.findIndex((item) => item.id === id);
    if (index === -1) return;
    queue.splice(index, 1);
    notifyQueueChanged();
  }

  /**
   * Builds a stable-enough CSS selector path for an element: a chain of tag+nth-of-type from the
   * element up to (but not including) <html>, preferring an id segment when one is present since
   * ids are far more resistant to markup churn than positional indices.
   */
  function buildSelector(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node !== null && node.nodeName.toLowerCase() !== "html") {
      const current: Element = node;
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      const parent: Element | null = current.parentElement;
      if (parent === null) {
        parts.unshift(current.nodeName.toLowerCase());
        break;
      }
      const siblingTag = current.nodeName;
      const siblings: Element[] = Array.from(parent.children).filter(
        (child) => child.nodeName === siblingTag,
      );
      const index = siblings.indexOf(current) + 1;
      const tag = current.nodeName.toLowerCase();
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      node = parent;
    }
    return parts.join(" > ");
  }

  /**
   * A short, deterministic content fingerprint (issue #10): FNV-1a over a string, chosen over
   * Web Crypto's subtle.digest because that's async and this needs to run synchronously inline
   * with selection handling. Not a security hash — collisions are an acceptable, low-stakes risk
   * here (worst case: a genuinely-drifted annotation stays unflagged until a future recheck),
   * not something worth a stronger algorithm for.
   */
  function fingerprint(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
  }

  // ---- Shadow-DOM UI chrome -------------------------------------------------------------

  const host = document.createElement("div");
  host.style.all = "initial";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .inkloop-highlight {
      position: fixed; pointer-events: none; z-index: 2147483646;
      outline: 2px solid #6f5bff; outline-offset: 1px; background: rgba(111, 91, 255, 0.08);
    }
    .inkloop-composer {
      /* Issue #64: widened ~1.4x (280px -> 392px) — comments longer than a line or two were
         cramped into a lot of internal scrolling at the old size. */
      position: fixed; z-index: 2147483647; max-width: 392px;
      font: 13px/1.4 system-ui, sans-serif; background: #1c1c22; color: #f2f2f5;
      border-radius: 10px; padding: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }
    .inkloop-composer textarea {
      width: 100%; min-height: 56px; max-height: 200px; box-sizing: border-box; resize: none;
      overflow-y: auto; background: #101014; color: inherit; border: 1px solid #3a3a44;
      border-radius: 6px; padding: 6px; font: inherit; margin-bottom: 6px;
    }
    .inkloop-composer .inkloop-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .inkloop-composer button {
      font: inherit; border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer;
    }
    .inkloop-composer .inkloop-add { background: #6f5bff; color: white; }
    .inkloop-composer .inkloop-cancel { background: transparent; color: #b3b3bd; }
    .inkloop-hidden { display: none; }
  `;
  const highlight = document.createElement("div");
  highlight.className = "inkloop-highlight inkloop-hidden";
  const composer = document.createElement("div");
  composer.className = "inkloop-composer inkloop-hidden";
  composer.innerHTML = `
    <textarea placeholder="Add a comment…"></textarea>
    <div class="inkloop-actions">
      <button type="button" class="inkloop-cancel">Cancel</button>
      <button type="button" class="inkloop-add">Add</button>
    </div>
  `;
  shadow.append(style, highlight, composer);

  function appendHostOnceReady(): void {
    (document.body ?? document.documentElement).appendChild(host);
  }
  if (document.body) appendHostOnceReady();
  else document.addEventListener("DOMContentLoaded", appendHostOnceReady, { once: true });

  const textarea = composer.querySelector("textarea") as HTMLTextAreaElement;
  const addButton = composer.querySelector(".inkloop-add") as HTMLButtonElement;
  const cancelButton = composer.querySelector(".inkloop-cancel") as HTMLButtonElement;
  let pendingTarget: FeedbackTarget | null = null;

  /** Pins the highlight box to a viewport rect and shows it, independent of picking mode — used
   * both by the hover-highlight during picking and to keep the picked element/range visually
   * anchored for as long as the composer stays open (issue #27). */
  function pinHighlight(rect: DOMRectReadOnly): void {
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.classList.remove("inkloop-hidden");
  }

  /**
   * Auto-grows the textarea to fit its content (issue #41), up to the CSS max-height above,
   * beyond which it scrolls internally instead of continuing to grow. Resetting height to "auto"
   * first (rather than only ever growing) lets scrollHeight shrink back down too, e.g. after the
   * user deletes a line or the composer is reopened with an empty value.
   */
  function autoGrowTextarea(): void {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    // The composer is positioned near the click point with a static estimate of its own height
    // (see showComposerAt below); once the textarea grows past that estimate, re-clamp so the
    // composer itself doesn't run off the bottom of the viewport.
    const maxTop = window.innerHeight - composer.getBoundingClientRect().height - 8;
    const currentTop = parseFloat(composer.style.top) || 0;
    if (currentTop > maxTop) composer.style.top = `${Math.max(8, maxTop)}px`;
  }

  function hideComposer(): void {
    composer.classList.add("inkloop-hidden");
    highlight.classList.add("inkloop-hidden");
    textarea.value = "";
    textarea.style.height = "";
    pendingTarget = null;
  }

  // rect is the picked element/range's own bounding box (issue #27) — the highlight stays pinned
  // to it for as long as the composer is open, not just during the hover/pick phase, so the human
  // keeps the visual anchor for what they're commenting on while writing the comment.
  function showComposerAt(x: number, y: number, target: FeedbackTarget, rect: DOMRectReadOnly): void {
    pendingTarget = target;
    pinHighlight(rect);
    composer.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 408))}px`;
    composer.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 140))}px`;
    composer.classList.remove("inkloop-hidden");
    textarea.value = "";
    textarea.style.height = "";
    textarea.focus();
  }

  addButton.addEventListener("click", () => {
    if (pendingTarget) queueItem(pendingTarget, textarea.value);
    hideComposer();
  });
  cancelButton.addEventListener("click", hideComposer);
  textarea.addEventListener("input", autoGrowTextarea);

  // ---- Element picker ---------------------------------------------------------------------

  let pickingElement = false;

  /**
   * Issue #42 follow-up: the OS-default "crosshair" cursor (a bare black "+") reads as generic
   * browser chrome, not something inkloop drew on purpose, and a target-reticle replacement
   * (tried first) still read as the same crosshair shape just recolored. A small comment-bubble
   * glyph instead says "click to annotate" on its own terms — same violet accent used everywhere
   * else a pick is in progress (the highlight outline below, the review shell's own "Sidenote"
   * toggle), with a dark outline so it stays legible over light-background artifacts too. Hotspot
   * sits at the tip of the bubble's tail, the same "this corner is where the click lands"
   * convention comment-cursor patterns elsewhere (Figma, Notion) use. Data URI, not a network
   * asset — matches the rest of this SDK's zero-fetch constraint. Falls back to "crosshair" for
   * the rare browser that rejects the custom cursor image outright.
   */
  const PICK_CURSOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M4 3.5 L4 15 L8.2 15 L11 19 L11 15 L20 15 L20 3.5 Z" ' +
    'fill="#6f5bff" stroke="#0b0b0f" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<circle cx="8.2" cy="9.2" r="1.1" fill="#f4f2ff"/>' +
    '<circle cx="12" cy="9.2" r="1.1" fill="#f4f2ff"/>' +
    '<circle cx="15.8" cy="9.2" r="1.1" fill="#f4f2ff"/>' +
    "</svg>";
  const PICK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PICK_CURSOR_SVG)}") 11 19, crosshair`;

  /**
   * Toggles picking mode and its visible side effects: a custom reticle cursor on the artifact so
   * it's obvious a click will select rather than click through, and a postMessage telling the
   * review shell the real current state. The shell used to guess this optimistically from its
   * own toggle button clicks alone, which drifted out of sync as soon as a pick completed
   * (issue #18). Picking mode itself now stays on across multiple picks (issue #54) — this only
   * flips off on an explicit re-toggle or one of the other call sites that already turn it off
   * today (markEnded, live reload).
   */
  function setPickingElement(value: boolean): void {
    pickingElement = value;
    document.documentElement.style.cursor = value ? PICK_CURSOR : "";
    if (!value) highlight.classList.add("inkloop-hidden");
    postToParent({ type: "inkloop:picking", active: value });
  }

  function isSdkNode(el: EventTarget | null): boolean {
    return el === host || (el instanceof Node && host.contains(el));
  }

  /**
   * Issue #62: <body>/<html> themselves are never a meaningful pick target: they're the page's outer
   * wrapper, not "an element" in the sense a reviewer means when picking one to comment on. Once
   * the cursor is over empty space inside that wrapper (below the artifact's real content, in its
   * padding, etc.) event.target still resolves to one of these two, which without this check kept
   * the highlight pinned to that huge wrapper rect — reading as "still selected" even though the
   * cursor isn't over anything worth annotating.
   */
  function isUnpickable(el: Element): boolean {
    return el === document.body || el === document.documentElement;
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      // Also gate on pendingTarget: while the composer is open the highlight is pinned to the
      // just-picked element/range (issue #27) and must stay put, not get dragged around by the
      // mouse moving over the rest of the artifact behind the composer.
      if (!pickingElement || pendingTarget) return;
      const target = event.target;
      if (!(target instanceof Element) || isSdkNode(target) || isUnpickable(target)) {
        highlight.classList.add("inkloop-hidden");
        return;
      }
      pinHighlight(target.getBoundingClientRect());
    },
    { capture: true },
  );

  /**
   * Never let the artifact's own links navigate the review iframe away (issue #37) — a reviewer
   * clicking or selecting an ordinary `<a href>` (a citation, a "view source" link, anything an
   * agent legitimately adds) would otherwise lose the whole review surface with no way back short
   * of reloading the session URL. Applies regardless of picking mode: even outside element-picking,
   * a click/selection on a link is still a click inside the artifact, not a request to browse away
   * from it.
   */
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || isSdkNode(target)) return;
      if (target.closest("a[href]")) event.preventDefault();
    },
    { capture: true },
  );

  document.addEventListener(
    "click",
    (event) => {
      // Issue #54: picking mode stays on across picks, so also skip while the composer for a
      // prior pick is still open (pendingTarget set) rather than re-picking out from under it.
      if (!pickingElement || pendingTarget) return;
      const target = event.target;
      if (!(target instanceof Element) || isSdkNode(target) || isUnpickable(target)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = target.getBoundingClientRect();
      showComposerAt(
        event.clientX,
        event.clientY,
        { kind: "element", selector: buildSelector(target) },
        rect,
      );
    },
    { capture: true },
  );

  // ---- Text-range picker ------------------------------------------------------------------

  document.addEventListener("mouseup", (event) => {
    // Issue #80: annotating a text range requires Sidenote to be active, same as the element
    // picker just above - a bare native word/paragraph selection (double/triple-click) must not
    // open the composer on its own just because it happens to be non-collapsed.
    if (!pickingElement || pendingTarget) return;
    if (isSdkNode(event.target)) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const text = selection.toString();
    if (!text.trim()) return;

    const range = selection.getRangeAt(0);
    const container =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (!container || isSdkNode(container)) return;

    const anchorText = container.textContent ?? "";
    const startOffset = anchorText.indexOf(text);
    const target: FeedbackTarget = {
      kind: "text-range",
      selector: buildSelector(container),
      quote: text.slice(0, 10_000),
      // Captured against the container's full live text, not just the quote — drift should also
      // catch edits elsewhere inside the same anchor that shift where the quote sits, not only
      // edits to the quoted substring itself. See checkDrift below for the other half of this.
      fingerprint: fingerprint(anchorText),
      ...(startOffset >= 0
        ? { startOffset, endOffset: startOffset + text.length }
        : {}),
    };
    showComposerAt(event.clientX, event.clientY, target, range.getBoundingClientRect());
  });

  // ---- postMessage bridge to the parent (review shell, issue #6) -------------------------

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const data = event.data as
      | { type?: string; comment?: string; id?: string; queue?: FeedbackItem[]; scrollY?: number }
      | undefined;
    if (!data || typeof data.type !== "string") return;

    switch (data.type) {
      case "inkloop:toggle-element-picker":
        setPickingElement(!pickingElement);
        break;
      case "inkloop:add-comment":
        if (typeof data.comment === "string") queueItem({ kind: "general" }, data.comment);
        break;
      case "inkloop:remove":
        if (typeof data.id === "string") removeQueueItem(data.id);
        break;
      case "inkloop:send":
        void sendQueue();
        break;
      case "inkloop:restore-draft":
        restoreDraft(data.queue, data.scrollY);
        break;
      default:
        break;
    }
  });

  /**
   * Re-applies unsent queue items and scroll position the review shell handed back after a live
   * reload (issue #8) reloaded this iframe from scratch. The shell already holds this state
   * continuously via the inkloop:queue/inkloop:scroll messages below — sent unconditionally on
   * every inkloop:ready, including the very first (non-reload) load, where both are empty/zero
   * and this is a harmless no-op.
   */
  function restoreDraft(restoredQueue: FeedbackItem[] | undefined, scrollY: number | undefined): void {
    if (Array.isArray(restoredQueue)) {
      queue.length = 0;
      queue.push(...restoredQueue);
    }
    if (typeof scrollY === "number") {
      // Applied synchronously, not deferred to requestAnimationFrame: rAF callbacks are heavily
      // throttled (sometimes by seconds) for an iframe that isn't currently visible/focused —
      // a likely state for exactly this feature, since the whole point of live reload is
      // picking up an agent's revision while the human isn't necessarily looking at the tab
      // right then. By the time inkloop:ready fires the document is already parsed and its
      // layout is already measurable, so there's nothing to wait on here.
      window.scrollTo(0, scrollY);
    }
  }

  // ---- Scroll reporting (issue #8) -------------------------------------------------------

  /** Throttles scroll reports to at most one per SCROLL_REPORT_THROTTLE_MS, via setTimeout
   * rather than requestAnimationFrame — rAF callbacks are heavily throttled (by seconds, not
   * just skipped frames) for a backgrounded/unfocused iframe, which would leave the shell's
   * cached scroll position stale exactly when a reload is most likely to happen without the
   * human actively watching the tab. setTimeout has no such visibility dependency. */
  const SCROLL_REPORT_THROTTLE_MS = 100;
  let scrollReportTimer: ReturnType<typeof setTimeout> | undefined;
  function reportScroll(): void {
    if (scrollReportTimer) return;
    scrollReportTimer = setTimeout(() => {
      scrollReportTimer = undefined;
      postToParent({ type: "inkloop:scroll", scrollY: window.scrollY });
    }, SCROLL_REPORT_THROTTLE_MS);
  }
  window.addEventListener("scroll", reportScroll, { passive: true });

  async function sendQueue(): Promise<void> {
    if (queue.length === 0) {
      postToParent({ type: "inkloop:sent" });
      return;
    }
    try {
      const response = await fetch(`/session/${sessionHash}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queue),
      });
      if (!response.ok) throw new Error(`server responded ${response.status}`);
      queue.length = 0;
      notifyQueueChanged();
      postToParent({ type: "inkloop:sent" });
    } catch (err) {
      postToParent({
        type: "inkloop:send-error",
        message: err instanceof Error ? err.message : String(err),
        items: queue,
      });
    }
  }

  // ---- Drift detection (issue #10) --------------------------------------------------------

  /**
   * Recomputes the live fingerprint of every not-yet-delivered text-range annotation against the
   * *current* DOM and reports any mismatch to the server, so `inkloop poll` can hand the agent a
   * `drifted: true` flag instead of letting it resolve a comment against a passage that moved.
   * Runs once per artifact load, including every live-reload (issue #8) — since a full iframe
   * reload re-runs this whole IIFE from scratch, that's the natural check-in point: it's exactly
   * when the artifact the agent just revised becomes the live DOM this function reads.
   *
   * Best-effort, not a hard guarantee: an `inkloop poll` that's already in flight when this
   * artifact reloads can return an item before this check has a chance to flag it. Acceptable
   * for a local single-user tool — the alternative (blocking poll on a live browser round-trip)
   * would couple the agent-facing loop to a browser tab being open, which the rest of this
   * codebase deliberately avoids.
   */
  async function checkDrift(): Promise<void> {
    let history: { rounds?: { items?: FeedbackItem[] }[] };
    try {
      const response = await fetch(`/session/${sessionHash}/history`);
      if (!response.ok) return;
      history = (await response.json()) as typeof history;
    } catch {
      return;
    }

    const drifted: string[] = [];
    for (const round of history.rounds ?? []) {
      for (const item of round.items ?? []) {
        if (item.deliveredAt !== undefined || item.drifted) continue;
        const target = item.target;
        if (target.kind !== "text-range" || !target.selector || !target.fingerprint) continue;

        const container = document.querySelector(target.selector);
        const live = container ? fingerprint(container.textContent ?? "") : undefined;
        if (live !== target.fingerprint) drifted.push(item.id);
      }
    }
    if (drifted.length === 0) return;

    try {
      await fetch(`/session/${sessionHash}/drift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: drifted }),
      });
    } catch {
      // Best-effort, same as above — a failed report just leaves it to the next reload's check.
    }
  }
  void checkDrift();

  // ---- Suggested prompts (issue #73) ------------------------------------------------------
  /**
   * Contextual starter prompts for the review shell's composer, instead of a blank box on first
   * open. Two tiers, both computed fresh on every load including live reloads (issue #8's full
   * iframe reload re-runs this whole IIFE, so that's the natural recompute point):
   *
   *  1. Agent-embedded (readEmbeddedSuggestions below) — the agent that wrote this artifact is
   *     already the one best placed to know what's worth asking about it, so this takes priority
   *     whenever present. No inkloop-side LLM call: the same "no inkloop support needed" pattern
   *     AGENTS.md documents for embedding a Mermaid script — a plain, inert-if-ignored
   *     <script type="application/json"> tag any artifact can include on its own, so opening the
   *     saved .html file directly still renders identically and no API key/network call/per-open
   *     cost is added to inkloop's own core loop.
   *  2. DOM heuristics (computeHeuristicSuggestions below) — a synchronous, free, local scan for
   *     when the artifact doesn't embed its own suggestions, so a reviewer still sees *something*
   *     rather than nothing on an artifact an agent didn't bother annotating.
   */
  const MAX_SUGGESTIONS = 3;

  function truncateForPrompt(text: string, max: number): string {
    const collapsed = text.trim().replace(/\s+/g, " ");
    return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed;
  }

  function readEmbeddedSuggestions(): string[] | null {
    const el = document.getElementById("inkloop-suggestions");
    if (!el || el.tagName !== "SCRIPT") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(el.textContent ?? "");
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    const cleaned = parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => truncateForPrompt(item, 140))
      .slice(0, MAX_SUGGESTIONS);
    return cleaned.length > 0 ? cleaned : null;
  }

  function computeHeuristicSuggestions(): string[] {
    const body = document.body;
    if (!body) return [];
    const suggestions: string[] = [];

    // Skip the first heading found - usually the artifact's own title, not a section worth
    // singling out on its own.
    const headings = Array.from(body.querySelectorAll("h1, h2, h3")).filter(
      (el) => !isSdkNode(el) && (el.textContent ?? "").trim().length > 0,
    );
    const sectionHeading = headings[1] ?? headings[0];
    if (sectionHeading) {
      const label = truncateForPrompt(sectionHeading.textContent ?? "", 60);
      suggestions.push(`Explain the reasoning behind the "${label}" section.`);
    }

    const badImage = Array.from(body.querySelectorAll("img")).find(
      (img) => !isSdkNode(img) && !(img.getAttribute("alt") ?? "").trim(),
    );
    if (badImage) suggestions.push("Is the image missing alt text accessible to screen readers?");

    const form = Array.from(body.querySelectorAll("form")).find((el) => !isSdkNode(el));
    if (form) suggestions.push("Does the form handle validation and error states?");

    const longParagraph = Array.from(body.querySelectorAll("p")).find(
      (p) => !isSdkNode(p) && (p.textContent ?? "").trim().length > 400,
    );
    if (longParagraph) {
      const label = truncateForPrompt(longParagraph.textContent ?? "", 60);
      suggestions.push(`Can this be simplified: "${label}"?`);
    }

    const genericFallbacks = [
      "Is this accessible (contrast, keyboard navigation, alt text)?",
      "What's the reasoning behind the overall layout?",
      "Any way to simplify this further?",
    ];
    for (const fallback of genericFallbacks) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      suggestions.push(fallback);
    }

    return suggestions.slice(0, MAX_SUGGESTIONS);
  }

  function computeSuggestions(): string[] {
    return readEmbeddedSuggestions() ?? computeHeuristicSuggestions();
  }

  postToParent({ type: "inkloop:suggestions", prompts: computeSuggestions() });
  postToParent({ type: "inkloop:ready" });
})();
