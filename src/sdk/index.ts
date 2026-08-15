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
  }

  interface FeedbackItem {
    id: string;
    target: FeedbackTarget;
    comment: string;
    createdAt: string;
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
      position: fixed; z-index: 2147483647; max-width: 280px;
      font: 13px/1.4 system-ui, sans-serif; background: #1c1c22; color: #f2f2f5;
      border-radius: 10px; padding: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }
    .inkloop-composer textarea {
      width: 100%; min-height: 56px; box-sizing: border-box; resize: vertical;
      background: #101014; color: inherit; border: 1px solid #3a3a44; border-radius: 6px;
      padding: 6px; font: inherit; margin-bottom: 6px;
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

  function hideComposer(): void {
    composer.classList.add("inkloop-hidden");
    textarea.value = "";
    pendingTarget = null;
  }

  function showComposerAt(x: number, y: number, target: FeedbackTarget): void {
    pendingTarget = target;
    composer.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 296))}px`;
    composer.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 140))}px`;
    composer.classList.remove("inkloop-hidden");
    textarea.value = "";
    textarea.focus();
  }

  addButton.addEventListener("click", () => {
    if (pendingTarget) queueItem(pendingTarget, textarea.value);
    hideComposer();
  });
  cancelButton.addEventListener("click", hideComposer);

  // ---- Element picker ---------------------------------------------------------------------

  let pickingElement = false;

  /**
   * Toggles picking mode and its visible side effects: a crosshair cursor on the artifact so
   * it's obvious a click will select rather than click through, and — since picking mode also
   * turns itself off the moment an element is picked, not just on an explicit toggle — a
   * postMessage telling the review shell the real current state. The shell used to guess this
   * optimistically from its own toggle button clicks alone, which drifted out of sync as soon as
   * a pick completed (issue #18).
   */
  function setPickingElement(value: boolean): void {
    pickingElement = value;
    document.documentElement.style.cursor = value ? "crosshair" : "";
    if (!value) highlight.classList.add("inkloop-hidden");
    postToParent({ type: "inkloop:picking", active: value });
  }

  function isSdkNode(el: EventTarget | null): boolean {
    return el === host || (el instanceof Node && host.contains(el));
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!pickingElement) return;
      const target = event.target;
      if (!(target instanceof Element) || isSdkNode(target)) {
        highlight.classList.add("inkloop-hidden");
        return;
      }
      const rect = target.getBoundingClientRect();
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      highlight.classList.remove("inkloop-hidden");
    },
    { capture: true },
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!pickingElement) return;
      const target = event.target;
      if (!(target instanceof Element) || isSdkNode(target)) return;
      event.preventDefault();
      event.stopPropagation();
      setPickingElement(false);
      showComposerAt(event.clientX, event.clientY, { kind: "element", selector: buildSelector(target) });
    },
    { capture: true },
  );

  // ---- Text-range picker ------------------------------------------------------------------

  document.addEventListener("mouseup", (event) => {
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
      ...(startOffset >= 0
        ? { startOffset, endOffset: startOffset + text.length }
        : {}),
    };
    showComposerAt(event.clientX, event.clientY, target);
  });

  // ---- postMessage bridge to the parent (review shell, issue #6) -------------------------

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const data = event.data as { type?: string; comment?: string; id?: string } | undefined;
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
      default:
        break;
    }
  });

  async function sendQueue(): Promise<void> {
    if (queue.length === 0) return;
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
      });
    }
  }

  postToParent({ type: "inkloop:ready" });
})();
