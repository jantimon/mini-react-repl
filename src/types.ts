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
   * Produced by `mini-react-repl/vendor-builder` with `types: 'embed'`.
   * The default vendor ships with this populated for the curated set.
   */
  types?: TypeBundle;
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

import type * as React from 'react';
