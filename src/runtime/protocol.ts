/**
 * Shared message protocol between the main thread and the iframe runtime.
 * This file is imported by both sides — keep it dependency-free.
 *
 * @internal
 */

/**
 * A transformed module sent across the postMessage boundary as raw source.
 * The iframe creates the blob URL inside its own context (parent-created
 * blob URLs don't load reliably in srcdoc iframes — Chromium scopes them).
 */
export type ModulePayload = {
  /** Logical path (e.g. `'App.tsx'`). */
  path: string;
  /** Transformed JS body (post-swc, NOT yet wrapped or rewritten). */
  code: string;
  /**
   * Relative imports this module makes. Each entry tells the iframe
   * "rewrite `specifier` to point at the current blob URL of `target`".
   * Bare specifiers are not listed — they resolve via the import map.
   */
  deps: { specifier: string; target: string }[];
};

/** Messages from main thread → iframe. */
export type ToIframe =
  | {
      kind: 'boot';
      entry: string;
      modules: ModulePayload[];
      cssFiles: { path: string; css: string }[];
    }
  | { kind: 'load'; module: ModulePayload }
  | { kind: 'unload'; path: string }
  | { kind: 'css-upsert'; path: string; css: string }
  | { kind: 'css-remove'; path: string }
  | {
      kind: 'transform-error';
      path: string;
      message: string;
      loc?: { line: number; column: number };
    }
  | { kind: 'resolve-error'; path: string; specifier: string }
  | { kind: 'clear-errors' }
  | { kind: 'reset' }
  // Carries the picker bundle (ESM source) so the runtime can dynamic-import
  // it via a blob URL on first inspect activation. Sent by `<InspectMode/>`.
  | { kind: 'inspect:install'; code: string }
  // Forwarded to the lazily-installed picker module — the runtime itself
  // does not act on these, but they ride the same `__repl` channel and
  // must be in the type so the runtime's exhaustiveness check passes.
  | { kind: 'inspect:enable'; overlayClassName?: string }
  | { kind: 'inspect:disable' };

/** Messages from iframe → main thread. */
export type FromIframe =
  | { kind: 'ready' }
  | { kind: 'mounted' }
  | { kind: 'runtime-error'; message: string; stack: string }
  | { kind: 'log'; level: 'log' | 'warn' | 'error'; args: unknown[] }
  // Ack for `inspect:install` — the picker has been dynamic-imported and its
  // message listener is live. Always sent, even if a prior install made this
  // call a no-op, so the host can chain `inspect:enable` after.
  | { kind: 'inspect:installed' };
