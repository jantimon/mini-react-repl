/**
 * Public types for `mini-react-repl`.
 *
 * These are the types consumers see in their IDE on hover and autocomplete.
 * Keep them lean and well-documented — they are part of the API surface.
 */

/**
 * A standard import-map plus an optional resolution base.
 *
 * `importMap` matches the W3C Import Maps shape exactly, so any URL the
 * browser can fetch (https, data:, blob:, relative) is valid as a target.
 *
 * @see https://github.com/WICG/import-maps
 */
export type VendorBundle = {
  /** Standard import-map JSON: `{ imports: { 'react': '/vendor/react.js' } }`. */
  importMap: ImportMap;
  /**
   * Optional base URL applied to relative entries in `importMap.imports`
   * when resolved inside the iframe. Set this when vendor files are hosted
   * under a non-default path (e.g. `/static/vendor`).
   */
  baseUrl?: string;
  /**
   * Optional `.d.ts` payload paired with the vendor's runtime modules.
   * Editors that support it (e.g. {@link https://www.npmjs.com/package/monaco-editor | Monaco})
   * consume this to provide red squiggles and hover signatures for the
   * vendor packages. Editors that don't support it ignore the field.
   *
   * Accepts a sync `TypeBundle`, a `Promise<TypeBundle>`, or a JSON-import
   * result (`{ default: TypeBundle }`). For custom-vendor builds the CLI
   * writes the payload to `<outDir>/repl.types.json` and embeds the URL as
   * {@link typesUrl}; the library fetches it automatically, so consumers
   * normally leave this field unset.
   *
   * The default vendor ships with this populated inline.
   */
  types?: TypeBundle | PromiseLike<TypeBundle | { default: TypeBundle }>;
  /**
   * Optional URL of a hosted `repl.types.json`. When set and {@link types}
   * is unset, the library fetches and registers the payload automatically.
   *
   * Emitted by `repl-vendor-build` into the bundler-imported import-map
   * JSON, so:
   *
   * ```tsx
   * import vendor from './vendor/repl.vendor.json';
   * <Repl vendor={vendor} ... />
   * ```
   *
   * is enough — types load in parallel without any consumer-side fetch.
   * Override by setting `types` directly.
   */
  typesUrl?: string;
};

/**
 * `.d.ts` payload bundled alongside a {@link VendorBundle}.
 *
 * Each entry is a single `.d.ts` file string keyed by the URI under which
 * an editor should register it. Convention is
 * `file:///node_modules/<pkg>/<entry>.d.ts` so cross-file `import` lookups
 * inside the bundle resolve naturally.
 */
export type TypeBundle = {
  /** Flat list of `.d.ts` files keyed by their registration URI. */
  libs: Array<{ path: string; content: string }>;
};

/** A standard W3C import-map. */
export type ImportMap = {
  imports: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
};

/**
 * The flat path → source map a consumer passes via `files`.
 *
 * Paths are logical, not filesystem: no folders, no leading slash convention,
 * just `'App.tsx'`, `'Counter.tsx'`, `'styles.css'`. Imports between files
 * use `./Name` syntax.
 */
export type Files = Record<string, string>;

/** Errors surfaced through `onPreviewError`. */
export type ReplError =
  | {
      kind: 'transform';
      path: string;
      message: string;
      loc?: { line: number; column: number };
    }
  | {
      kind: 'runtime';
      message: string;
      stack: string;
    }
  | {
      kind: 'resolve';
      path: string;
      specifier: string;
    };

/** Props every editor adapter component must accept. */
export type ReplEditorProps = {
  /** Logical path of the file currently being edited. */
  path: string;
  /** Current source. */
  value: string;
  /** Called on every change. The library handles its own debouncing internally. */
  onChange: (next: string) => void;
  /** Editor language hint derived from the file extension. */
  language: 'typescript' | 'javascript' | 'css';
  /**
   * Optional vendor `.d.ts` payload the editor may register with its
   * TypeScript service. Forwarded from `vendor.types` by the host. Editors
   * that don't consume types ignore this.
   */
  types?: TypeBundle;
  /**
   * The full file table forwarded from the host's `files` prop. Editors with
   * a TypeScript service (e.g. Monaco) need every file to be visible so
   * cross-file imports (`import { X } from './Y'`) resolve, even when only
   * one file is open. Editors that don't need it ignore this.
   */
  files?: Files;
};

/** A component matching {@link ReplEditorProps}. */
export type ReplEditorComponent = React.ComponentType<ReplEditorProps>;

/** Options accepted by {@link ReplTransform}. */
export type ReplTransformOptions = {
  /**
   * Whether to parse JSX. Mirrors swc's `jsc.parser.tsx` flag.
   * @defaultValue `false`
   */
  tsx?: boolean;
};

/**
 * The built-in swc-wasm transform, scoped to a single file's logical path.
 * Returns transformed JS (TypeScript stripped, JSX optionally compiled,
 * React Refresh signatures injected, inline source map). Used by loaders
 * to leverage the same compiler the {@link defaultLoader} uses.
 */
export type ReplTransform = (source: string, options?: ReplTransformOptions) => Promise<string>;

/** Input handed to a {@link ReplLoader} for each file. */
export type ReplLoaderInput = {
  /** Logical path of the file (e.g. `'data.sqlite'`, `'App.tsx'`). */
  path: string;
  /** Raw source text from the consumer's `files` map. */
  source: string;
  /** swc-wasm transform bound to this file's path. */
  transform: ReplTransform;
};

/**
 * What a {@link ReplLoader} returns to claim a file.
 *
 * - `{ kind: 'css', source }` — inject `source` as a `<style>` tag.
 * - `{ kind: 'module', code }` — `code` must be already-compiled JS (call
 *   `input.transform()` from the loader if you need swc to do that). The
 *   engine still runs `rewriteImports` on it so relative specifiers resolve.
 *
 * Returning `null` / `undefined` skips the file entirely.
 */
export type ReplLoaderResult = { kind: 'css'; source: string } | { kind: 'module'; code: string };

/**
 * Pre-processor invoked once per file (on initial load and on every source
 * change). Useful for turning custom file types — `.sqlite`, `.md`, `.json`,
 * `.svg` — into a JS module the REPL can execute, or into CSS the iframe can
 * inject.
 *
 * A user-supplied loader **replaces** the {@link defaultLoader}; delegate
 * back to it for files you don't care about.
 *
 * @example
 * ```ts
 * import { defaultLoader, type ReplLoader } from 'mini-react-repl';
 *
 * const loader: ReplLoader = async (input) => {
 *   if (input.path.endsWith('.sqlite')) {
 *     return {
 *       kind: 'module',
 *       code: `export default ${JSON.stringify(parseSqlite(input.source))};`,
 *     };
 *   }
 *   return defaultLoader(input);
 * };
 * ```
 */
export type ReplLoader = (
  input: ReplLoaderInput,
) => ReplLoaderResult | null | undefined | Promise<ReplLoaderResult | null | undefined>;

import type * as React from 'react';
