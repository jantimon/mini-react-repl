/**
 * Public types for `mini-react-repl`.
 *
 * These are the types consumers see in their IDE on hover and autocomplete.
 * Keep them lean and well-documented — they are part of the API surface.
 */

/**
 * A standard import-map plus an optional `.d.ts` payload.
 *
 * `importMap` matches the W3C Import Maps shape exactly. Every entry must be
 * a URL the browser can fetch from a sandboxed iframe; in practice that
 * means `data:` URLs (what `repl-vendor-build` produces) or fully-qualified
 * `https://` URLs with permissive CORS headers.
 *
 * @see https://github.com/WICG/import-maps
 */
export type VendorBundle = {
  /**
   * Standard import-map JSON:
   * `{ imports: { 'react': 'data:text/javascript;base64,...' } }`.
   *
   * Accepts:
   * - a sync `ImportMap`,
   * - a `Promise<ImportMap>` or JSON-import result (`{ default: ImportMap }`),
   * - or a **function** returning either of the above — invoked once on
   *   `<Repl/>` mount so the bundler code-splits the import-map data into
   *   its own chunk. Routes that never mount `<Repl/>` don't pay for it.
   *
   * The library waits for this to resolve before booting the iframe (the
   * browser needs `<script type="importmap">` inlined in the srcdoc before
   * any module script that imports a bare specifier can run).
   */
  importMap:
    | ImportMap
    | PromiseLike<ImportMap | { default: ImportMap }>
    | (() => ImportMap | PromiseLike<ImportMap | { default: ImportMap }>);
  /**
   * Optional `.d.ts` payload paired with the vendor's runtime modules.
   * Editors that support it (e.g. {@link https://www.npmjs.com/package/monaco-editor | Monaco})
   * consume this to provide red squiggles and hover signatures for the
   * vendor packages. Editors that don't support it ignore the field.
   *
   * Accepts:
   * - a sync `TypeBundle`,
   * - a `Promise<TypeBundle>` or JSON-import result (`{ default: TypeBundle }`),
   * - or a **function** returning either of the above — invoked lazily by
   *   the library when an editor adapter actually mounts. Preview-only
   *   consumers never trigger it. The default vendor uses this form so the
   *   `.d.ts` chunk only downloads when the editor needs it.
   */
  types?:
    | TypeBundle
    | PromiseLike<TypeBundle | { default: TypeBundle }>
    | (() => TypeBundle | PromiseLike<TypeBundle | { default: TypeBundle }>);
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

/**
 * Map of file extension to editor language id, or a function from path to id.
 *
 * Tells editor adapters (e.g. {@link https://www.npmjs.com/package/monaco-editor | Monaco})
 * how to syntax-highlight files served by a custom {@link ReplLoader} — e.g.
 * `.md` → `'markdown'`, `.json` → `'json'`. Adapters that don't consume the
 * `language` prop ignore this.
 *
 * Record keys are extensions **without** the leading dot (`'md'`, not
 * `'.md'`). Lookup falls back to the built-in dispatch for unknown
 * extensions: `.css` → `'css'`, `.js`/`.jsx`/`.mjs` → `'javascript'`,
 * everything else → `'typescript'`.
 *
 * @example
 * ```tsx
 * <Repl languages={{ md: 'markdown', json: 'json' }} ... />
 * ```
 *
 * @example
 * ```tsx
 * <Repl languages={(path) => path.endsWith('.svg') ? 'xml' : undefined} ... />
 * ```
 */
export type LanguageMap = Record<string, string> | ((path: string) => string | undefined);

/**
 * Inline modules exposed to the iframe under bare-specifier aliases.
 *
 * Each `key` is the import specifier user code may use (e.g. `'@app/util'`,
 * `'@scope/pkg'`); each `value` is the TSX source. The library compiles them
 * with the same swc pipeline as user files and the iframe runtime resolves
 * `import { x } from '@app/util'` to the compiled module.
 *
 * Pair with {@link VendorBundle} for ad-hoc helpers you don't want to ship
 * as a vendor chunk — small utilities, theming primitives, mock APIs.
 *
 * **Boot-time only.** Hoist to a top-level `as const` so the reference stays
 * stable; the library snapshots the value on first mount and ignores later
 * identity changes (with a dev-mode warning). Collisions with
 * `vendor.importMap.imports` keys resolve in favor of the virtual.
 *
 * CSS aliases (`'theme.css'` and similar) are not yet supported.
 */
export type VirtualModules = Record<string, string>;

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
  /**
   * Editor language id for the active file. Resolved by the host from the
   * consumer's `languages` prop (if provided) and the built-in dispatch
   * (`.css` → `'css'`, `.js`/`.jsx`/`.mjs` → `'javascript'`, everything
   * else → `'typescript'`).
   *
   * Adapters with a syntax-highlighter (e.g. Monaco) should use this to
   * pick the grammar; adapters without one can ignore it.
   */
  language: string;
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
  /**
   * Inline virtual modules forwarded from the host's `virtualModules` prop.
   * Editors with a TypeScript service register each entry as an extra lib so
   * cross-file imports of `@foo/bar` (etc.) resolve to the source — giving
   * autocomplete, hover signatures, and red squiggles. Editors that don't
   * consume it ignore this.
   */
  virtualModules?: VirtualModules;
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
