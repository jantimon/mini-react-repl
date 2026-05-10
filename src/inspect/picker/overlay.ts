/**
 * Hover overlay: a fixed-position outline that tracks the element under
 * the cursor while inspect mode is active. Lazily created on first use,
 * removed entirely on disable.
 *
 * @internal
 */

// Delay before showing the overlay after the cursor lands on a new element.
// Short enough to feel responsive when the user pauses on a target, long
// enough that pointer movements that just pass through the iframe never
// flash the overlay up.
const SHOW_DELAY_MS = 100;

// Opacity fade duration. Used both as the CSS `transition-duration` for
// fade-in/out and as the buffer between starting the fade-out and removing
// the element from the DOM in `destroyOverlay`.
const FADE_MS = 120;

// Position/size animation duration when gliding between elements. Tuned
// to match Chrome DevTools' inspect overlay — quick enough to feel snappy,
// slow enough that the eye can track which element is selected.
const POSITION_MS = 140;

// CSS `transition` shorthand applied via DEFAULT_STYLE. Includes left/top/
// width/height so the overlay glides between elements when the user moves
// the cursor across them. When the overlay is invisible, `moveOverlayTo`
// suppresses the position transitions for one frame so the next fade-in
// lands at the new element instead of gliding in from the previous one.
const FULL_TRANSITION =
  `opacity ${FADE_MS}ms linear, ` +
  `left ${POSITION_MS}ms ease, ` +
  `top ${POSITION_MS}ms ease, ` +
  `width ${POSITION_MS}ms ease, ` +
  `height ${POSITION_MS}ms ease`;

const DEFAULT_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  // Cancel the popover UA's `inset: 0` so `moveOverlayTo` controls geometry
  // entirely via `left`/`top`/`width`/`height`. Without this, `right: 0`
  // and `bottom: 0` linger and over-constrain the box.
  inset: 'auto',
  pointerEvents: 'none',
  zIndex: '2147483647',
  boxSizing: 'border-box',
  // The popover UA stylesheet ships `border: solid` (medium width, currentColor)
  // — a thick black ring that's the wrong look for an inspect overlay.
  // Explicitly zero it; the bluish fill + boxShadow do the work.
  border: 'none',
  background: 'rgba(59, 130, 246, 0.15)',
  borderRadius: '2px',
  // Soft blue-tinted glow — picks up the fill colour without competing with
  // it. Two layers: a tight close shadow for definition, a softer outer one
  // for depth. Subtle on light backgrounds, invisible on dark.
  boxShadow: '0 1px 2px rgba(59, 130, 246, 0.18), 0 4px 12px rgba(59, 130, 246, 0.18)',
  transition: FULL_TRANSITION,
  opacity: '0',
  margin: '0',
  padding: '0',
  display: 'block',
};

let overlayEl: HTMLDivElement | null = null;
let appliedClassName: string | undefined;
let showTimer: ReturnType<typeof setTimeout> | null = null;

function clearShowTimer(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

/**
 * Create (or reuse) the overlay element and apply the consumer's class
 * name. Passing an empty string skips the default styling so consumers
 * can build their own visual entirely from CSS.
 */
function ensureOverlay(className: string | undefined): HTMLDivElement {
  let created = false;
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.setAttribute('data-repl-inspect-overlay', '');
    // Promote into the top layer so the overlay paints above modal
    // `<dialog>`s, popovers, and `:fullscreen` elements — all of which
    // outrank any `z-index`. `popover="manual"` is the right flavor: no
    // light-dismiss, no focus trap, doesn't dismiss other open popovers.
    // `showPopover()` may throw on browsers without the API; the z-index
    // in DEFAULT_STYLE is the fallback for that case.
    if ('showPopover' in overlayEl) {
      overlayEl.setAttribute('popover', 'manual');
    }
    document.documentElement.appendChild(overlayEl);
    if ('showPopover' in overlayEl) {
      try {
        (overlayEl as HTMLElement & { showPopover: () => void }).showPopover();
      } catch {
        // Element may have been disconnected, or the document state forbids
        // showing right now. Fall back to z-index — still visible against
        // everything outside the top layer.
      }
    }
    created = true;
  }
  // The className guard avoids re-applying styles on every mousemove. Skip
  // it on the first call after creation, otherwise an `undefined` className
  // (the default-styled path) matches the initial `appliedClassName` of
  // `undefined` and we'd return the bare element with no border/fill.
  if (!created && className === appliedClassName) return overlayEl;
  appliedClassName = className;
  overlayEl.className = className ?? '';
  if (className === undefined || className === null) {
    Object.assign(overlayEl.style, DEFAULT_STYLE);
  } else {
    // Consumer-styled: clear the inline defaults so their CSS wins. Keep
    // the positioning bits the picker writes per-frame (left/top/width/
    // height) — those are set by `moveOverlayTo`. `inset: auto` cancels
    // the popover UA's `inset: 0` (the popover attribute is still set so
    // we stay in the top layer; consumers don't get to opt out of that).
    overlayEl.removeAttribute('style');
    overlayEl.style.position = 'fixed';
    overlayEl.style.inset = 'auto';
    overlayEl.style.border = 'none';
    overlayEl.style.pointerEvents = 'none';
    overlayEl.style.zIndex = '2147483647';
    overlayEl.style.opacity = '0';
  }
  return overlayEl;
}

export function moveOverlayTo(el: Element | null, className: string | undefined): void {
  if (!el) {
    // Hide is instant (no delay) so leaving the iframe doesn't leave the
    // overlay lingering. The CSS transition still gives a 120ms fade-out.
    // The element stays in the DOM so the next reposition can snap to a
    // new target without a fresh appendChild.
    clearShowTimer();
    if (overlayEl) overlayEl.style.opacity = '0';
    return;
  }
  const rect = el.getBoundingClientRect();
  const ov = ensureOverlay(className);

  if (ov.style.opacity === '1') {
    // Already visible — let the CSS transition glide left/top/width/height
    // to the new element so the user's eye can track the move.
    ov.style.left = rect.left + 'px';
    ov.style.top = rect.top + 'px';
    ov.style.width = rect.width + 'px';
    ov.style.height = rect.height + 'px';
    return;
  }

  // Invisible (initial show, or re-entering after a fade-out). Snap the
  // position so the eventual fade-in appears at the new element instead of
  // gliding in from wherever it last was. Suppressing the transition for
  // one reflow is enough; we restore the full transition before the show
  // timer fires so the fade-in still animates smoothly.
  const restore = ov.style.transition;
  ov.style.transition = 'none';
  ov.style.left = rect.left + 'px';
  ov.style.top = rect.top + 'px';
  ov.style.width = rect.width + 'px';
  ov.style.height = rect.height + 'px';
  void ov.offsetWidth;
  ov.style.transition = restore;

  // Pending show — the timer will fire at the snapped position above.
  if (showTimer !== null) return;
  showTimer = setTimeout(() => {
    showTimer = null;
    if (overlayEl) overlayEl.style.opacity = '1';
  }, SHOW_DELAY_MS);
}

/**
 * Fade the overlay out then detach it. The element stays in the DOM (and in
 * the top layer) until the fade finishes so disabling inspect mode doesn't
 * cause an instant disappear.
 */
export function destroyOverlay(): void {
  clearShowTimer();
  if (!overlayEl) return;
  // Capture the live ref so the removal closure operates on this specific
  // element. If the picker re-enables before the timer fires, a fresh
  // overlay will be created (overlayEl=null below) and the two coexist
  // briefly until the old one's removal completes — which is fine.
  const el = overlayEl;
  overlayEl = null;
  appliedClassName = undefined;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), FADE_MS);
}
