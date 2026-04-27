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
  | { kind: 'reset' };

/** Messages from iframe → main thread. */
export type FromIframe =
  | { kind: 'ready' }
  | { kind: 'mounted' }
  | { kind: 'runtime-error'; message: string; stack: string }
  | { kind: 'log'; level: 'log' | 'warn' | 'error'; args: unknown[] };
