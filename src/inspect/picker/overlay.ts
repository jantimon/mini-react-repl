/**
 * Hover overlay: a fixed-position outline that tracks the element under
 * the cursor while inspect mode is active. Lazily created on first use,
 * removed entirely on disable.
 *
 * @internal
 */

const DEFAULT_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
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
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.setAttribute('data-repl-inspect-overlay', '');
    document.documentElement.appendChild(overlayEl);
  }
  if (className === appliedClassName) return overlayEl;
  appliedClassName = className;
  overlayEl.className = className ?? '';
  if (className === undefined || className === null) {
    Object.assign(overlayEl.style, DEFAULT_STYLE);
  } else {
    // Consumer-styled: clear the inline defaults so their CSS wins. Keep
    // the positioning bits the picker writes per-frame (left/top/width/
    // height) — those are set by `moveOverlayTo`.
    overlayEl.removeAttribute('style');
    overlayEl.style.position = 'fixed';
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
