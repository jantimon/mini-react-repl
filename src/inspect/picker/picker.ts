/**
 * In-iframe element picker.
 *
 * Bundled by `scripts/build-picker.mjs` and inlined as a third
 * `<script type="module">` in the iframe srcdoc (after preamble + runtime).
 * Stays dormant until the host posts `inspect:enable`. On click, walks the
 * React fiber chain, parses each fiber's `_debugStack`, and decodes the
 * frames against the inline source map of the wrapped module — yielding
 * source-space `(fileName, line, column)` for the host to consume.
 *
 * @internal
 */

import {
  findHostElementWithFiber,
  getComponentName,
  getFiberFromElement,
  walkFibers,
  type FiberLike,
} from './fiber-walk.ts';
import { destroyOverlay, moveOverlayTo } from './overlay.ts';
import { isSourceCandidate, parseStack } from './parse-stack.ts';
import { getModuleRecord } from './module-text.ts';
import { clearTraceMapCache, invalidateTraceMap, lookupSourcePosition } from './source-map.ts';

type StackFrame = {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
  componentName: string | null;
};

type ElementPick = {
  dom: { tag: string; text: string | null; boundingRect: DOMRectReadOnly };
  stack: StackFrame[];
};

let enabled = false;
let lastTarget: Element | null = null;
let overlayClassName: string | undefined;
let cursorStyleEl: HTMLStyleElement | null = null;

function postToParent(msg: { kind: string; [k: string]: unknown }): void {
  parent.postMessage({ __repl: true, ...msg }, '*');
}

/**
 * Force the default arrow cursor across the entire document while inspect
 * mode is on. User CSS happily applies `cursor: pointer` on links and
 * buttons, `cursor: text` on inputs, etc. — those are confusing during a
 * pick because the cursor implies an action that won't happen. The
 * stylesheet attaches/detaches via `setEnabled` and selects on the
 * `data-repl-inspect-active` attribute already toggled on `<html>`.
 */
function setCursorOverride(active: boolean): void {
  if (active) {
    if (cursorStyleEl) return;
    cursorStyleEl = document.createElement('style');
    cursorStyleEl.setAttribute('data-repl-inspect-cursor-style', '');
    cursorStyleEl.textContent =
      'html[data-repl-inspect-active], html[data-repl-inspect-active] * { cursor: default !important; }';
    document.head.appendChild(cursorStyleEl);
  } else {
    cursorStyleEl?.remove();
    cursorStyleEl = null;
  }
}

function setEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  if (enabled) {
    // Match Chrome DevTools inspect mode: a single `default` cursor across
    // the whole document is the right signal — a crosshair implies "click
    // to pin a coordinate" and the user CSS cursors (pointer on links,
    // text on inputs) imply actions that won't fire while picking.
    document.documentElement.setAttribute('data-repl-inspect-active', '');
    setCursorOverride(true);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseleave', onMouseLeave, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
  } else {
    document.documentElement.removeAttribute('data-repl-inspect-active');
    setCursorOverride(false);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseleave', onMouseLeave, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    lastTarget = null;
    destroyOverlay();
  }
}

function onMouseMove(event: MouseEvent): void {
  if (!enabled) return;
  const el = findHostElementWithFiber(event.target as Node | null);
  if (el === lastTarget) return;
  lastTarget = el;
  moveOverlayTo(el, overlayClassName);
}

function onMouseLeave(): void {
  if (!enabled) return;
  // Cursor left the iframe entirely — drop the highlight, mirroring how
  // DevTools' inspect overlay clears when you mouse out of the page.
  lastTarget = null;
  moveOverlayTo(null, overlayClassName);
}

function onClick(event: MouseEvent): void {
  if (!enabled) return;
  const el = findHostElementWithFiber(event.target as Node | null);
  if (!el) return;
  const fiber = getFiberFromElement(el);
  if (!fiber) return;
  // Capture-phase: stop the click from reaching user handlers (a hover
  // tooltip, a button onClick, etc.) once we've confirmed we'll handle it.
  // Clicks on non-fiber targets (iframe body margin, etc.) are left alone.
  event.preventDefault();
  event.stopPropagation();
  // Decode async — touching the source map is sync once parsed but the
  // first parse on a never-clicked module is best kept off the click
  // event itself.
  resolveStack(fiber)
    .then((stack) => {
      const pick: ElementPick = {
        dom: {
          tag: el.tagName.toLowerCase(),
          text: snippetFromElement(el),
          boundingRect: el.getBoundingClientRect(),
        },
        stack,
      };
      postToParent({ kind: 'inspect:pick', pick });
    })
    .catch(() => {
      // Swallow: a decode failure shouldn't crash the picker. Send an
      // empty-stack pick so the host still sees the click landed.
      postToParent({
        kind: 'inspect:pick',
        pick: {
          dom: {
            tag: el.tagName.toLowerCase(),
            text: snippetFromElement(el),
            boundingRect: el.getBoundingClientRect(),
          },
          stack: [],
        },
      });
    });
}

function onKeyDown(event: KeyboardEvent): void {
  if (!enabled) return;
  if (event.key === 'Escape') {
    postToParent({ kind: 'inspect:cancel' });
  }
}

async function resolveStack(start: FiberLike): Promise<StackFrame[]> {
  // Yield to the microtask queue so we don't block the click event.
  await Promise.resolve();
  const out: StackFrame[] = [];
  for (const fiber of walkFibers(start)) {
    const stack = fiber._debugStack?.stack;
    if (!stack) continue;
    const parsed = parseStack(stack);
    for (const frame of parsed) {
      if (!isSourceCandidate(frame)) continue;
      const source = lookupSourcePosition(frame.fileName, frame.line, frame.col, getModuleRecord);
      if (!source) continue;
      // The component name we want is the function/class *containing* the
      // JSX call site — that's `fiber._debugOwner` (the JSX call-site
      // author), not `fiber.type` itself (which for host fibers is just
      // the tag name like `'h1'`). Fall back to the fiber's own type for
      // composite-fiber stacks where the owner is missing.
      const ownerForName = fiber._debugOwner ?? fiber;
      out.push({
        fileName: source.fileName,
        lineNumber: source.lineNumber,
        columnNumber: source.columnNumber,
        componentName: getComponentName(ownerForName),
      });
      // One frame per fiber walk-step keeps the result aligned with the
      // owner chain instead of repeating frames a stack trace shares.
      break;
    }
  }
  return out;
}

function snippetFromElement(el: Element): string | null {
  let raw: string;
  try {
    raw = el.textContent ?? '';
  } catch {
    return null;
  }
  // Preserve line structure so consumers' tooltip UIs can render multi-line
  // text; collapse only intra-line whitespace. Cap at 5 lines × 140 chars.
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const truncated = lines.length > 5;
  const capped = lines
    .slice(0, 5)
    .map((line) => (line.length > 140 ? line.slice(0, 137) + '…' : line));
  let text = capped.join('\n');
  if (truncated) text += '\n…';
  return text;
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as {
    __repl?: unknown;
    kind?: unknown;
    overlayClassName?: unknown;
  } | null;
  if (!data || data.__repl !== true) return;
  if (data.kind === 'inspect:enable') {
    overlayClassName =
      typeof data.overlayClassName === 'string' ? data.overlayClassName : undefined;
    setEnabled(true);
  } else if (data.kind === 'inspect:disable') {
    setEnabled(false);
  }
});

// The runtime fires this whenever it (re)builds a wrapped module body.
// Drop the cached `TraceMap` so the next click reads the fresh inline map.
window.addEventListener('__repl:module-updated', (event) => {
  const detail = (event as CustomEvent<{ path?: string }>).detail;
  if (detail?.path) invalidateTraceMap(detail.path);
});

// On reset (the runtime drops every module record), wipe the whole cache.
// We piggyback on the same message bus the runtime uses.
window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { __repl?: unknown; kind?: unknown } | null;
  if (data?.__repl === true && data.kind === 'reset') clearTraceMapCache();
});
