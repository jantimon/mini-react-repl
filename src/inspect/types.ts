/**
 * Public types for the `mini-react-repl/inspect` subpath.
 *
 * @public
 */

/**
 * One JSX call site in the chain that produced a clicked element.
 *
 * Frames are ordered top-down: index 0 is the JSX call closest to the
 * clicked DOM node; later frames are the components that *rendered* that
 * JSX, walking up the React owner chain. Each frame's coordinates are in
 * **source space** — already source-map decoded — so consumers can pass
 * them directly to an editor / line-deep-link without further translation.
 */
export type StackFrame = {
  /**
   * Source path the JSX was written in. Whatever the iframe runtime knows
   * the module as: a logical path for user files (`'App.tsx'`,
   * `'./components/Card.tsx'`) or whatever the source-map's `sources[]`
   * field says for vendor / virtual modules. Consumers decide what to do
   * with each kind — there is no built-in classification.
   */
  fileName: string;
  /** 1-based source line. */
  lineNumber: number;
  /** 1-based source column. */
  columnNumber: number;
  /**
   * Function/class component that contains this JSX call. `null` for
   * frames where the call site is at module top level (e.g. memoized
   * elements created outside any component) or where React 19's debug
   * info doesn't expose a name.
   */
  componentName: string | null;
};

/**
 * What the picker hands back per click. `dom` is always populated;
 * `stack` may be empty (e.g. element rendered via `React.createElement`
 * not `jsxDEV`, or `dangerouslySetInnerHTML` content, or a vendor-only
 * chain with no source maps).
 */
export type ElementPick = {
  dom: {
    /** Lowercase tag name. `'div'`, `'h1'`, `'svg'`. */
    tag: string;
    /**
     * Trimmed multi-line text snippet from the element subtree. Capped at
     * 5 lines × 140 chars; trailing `…` if truncated. `null` if the
     * element has no text content.
     */
    text: string | null;
    /** Bounding rect at the moment of the click, viewport coords. */
    boundingRect: DOMRectReadOnly;
  };
  stack: StackFrame[];
};

/**
 * postMessage envelopes exchanged between host and the in-iframe picker.
 * All envelopes carry the same `__repl: true` discriminator the rest of
 * the runtime uses (see SPEC §8.4).
 *
 * @internal
 */
export type InspectToIframe =
  | { kind: 'inspect:enable'; overlayClassName?: string }
  | { kind: 'inspect:disable' };

/** @internal */
export type InspectFromIframe =
  | { kind: 'inspect:pick'; pick: ElementPick }
  | { kind: 'inspect:cancel' };
