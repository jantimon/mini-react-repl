/**
 * Reactively report the active color scheme by observing a transitioning
 * `color` value driven by CSS `light-dark()` — the cascade is the source
 * of truth.
 *
 * The consumer opts in by setting `color-scheme: light dark` (or any
 * variant — `only light`, `auto`, scoped subtrees) on `:root` or wherever
 * in their app; the watcher inherits that and reports whatever the
 * cascade resolves to. Without that opt-in, `light-dark()` resolves to
 * its first argument and the watcher reports `'light'`
 */
import { useCallback, useRef } from 'react';
export type ColorScheme = 'light' | 'dark';
export interface ColorSchemeWatcherProps {
  /**
   * Called once on mount with the current scheme, then on every
   * cascade-driven change.
   */
  onChange: (scheme: ColorScheme) => void;
}

/**
 * Renders a hidden `<div>` whose `color` is driven by `light-dark()` and
 * reports the resolved scheme via `onChange`. Fires once on mount with
 * the current value, then again on every change.
 *
 * @public
 */
export function ColorSchemeWatcher({ onChange }: ColorSchemeWatcherProps) {
  // Latest `onChange` lives in a ref so the callback ref below can keep
  // empty deps — the listener stays attached for the element's lifetime
  // even when consumers inline a new arrow on each render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const refCallback = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const read = (): ColorScheme =>
      getComputedStyle(el).color === 'rgb(0, 0, 0)' ? 'dark' : 'light';
    onChangeRef.current(read());
    const handler = (e: TransitionEvent) => {
      if (e.propertyName !== 'color') return;
      onChangeRef.current(read());
    };
    el.addEventListener('transitionstart', handler);
    return () => el.removeEventListener('transitionstart', handler);
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        pointerEvents: 'none',
        color: 'light-dark(white, black)',
        transition: 'color 1ms',
      }}
      ref={refCallback}
    />
  );
}
