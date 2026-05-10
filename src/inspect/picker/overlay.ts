/**
 * Hover overlay: a fixed-position outline that tracks the element under
 * the cursor while inspect mode is active. Lazily created on first use,
 * removed entirely on disable.
 *
 * @internal
 */

const DEFAULT_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  // Cancel the popover UA's `inset: 0` so `moveOverlayTo` controls geometry
  // entirely via `left`/`top`/`width`/`height`. Without this, `right: 0`
  // and `bottom: 0` linger and over-constrain the box.
  inset: 'auto',
  pointerEvents: 'none',
  zIndex: '2147483647',
  boxSizing: 'border-box',
  border: '2px solid #3b82f6',
  background: 'rgba(59,130,246,0.15)',
  borderRadius: '2px',
  transition: 'opacity 80ms linear',
  opacity: '0',
  margin: '0',
  padding: '0',
  display: 'block',
};

let overlayEl: HTMLDivElement | null = null;
let appliedClassName: string | undefined;

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
    overlayEl.style.pointerEvents = 'none';
    overlayEl.style.zIndex = '2147483647';
    overlayEl.style.opacity = '0';
  }
  return overlayEl;
}

export function moveOverlayTo(el: Element | null, className: string | undefined): void {
  if (!el) {
    if (overlayEl) overlayEl.style.opacity = '0';
    return;
  }
  const rect = el.getBoundingClientRect();
  const ov = ensureOverlay(className);
  ov.style.left = rect.left + 'px';
  ov.style.top = rect.top + 'px';
  ov.style.width = rect.width + 'px';
  ov.style.height = rect.height + 'px';
  ov.style.opacity = '1';
}

/** Detach the overlay from the DOM and reset internal state. */
export function destroyOverlay(): void {
  if (overlayEl) overlayEl.remove();
  overlayEl = null;
  appliedClassName = undefined;
}
