/**
 * Internal context shared between `<ReplProvider/>` and the headless
 * components. Not exported from the package root.
 *
 * Split into two contexts to minimize re-renders:
 *
 *   - {@link ReplStateContext} — reactive state (files, activePath, lastError).
 *     Changes on every edit / tab swap / error.
 *   - {@link ReplActionsContext} — stable across the provider's lifetime:
 *     CRUD callbacks plus boot config (vendor, entry, swcWasmUrl) snapshotted
 *     on first mount. Components that only need actions or boot config don't
 *     re-render on file edits.
 *
 * @internal
 */

import { createContext } from 'react';
import type {
  Files,
  LanguageMap,
  VendorBundle,
  ReplError,
  ReplLoader,
  VirtualModules,
} from '../types.ts';

export type ReplStateContextValue = {
  /** Current file table (mirrors the consumer's `files` prop). */
  files: Files;
  /** Currently selected file path in the editor. */
  activePath: string | null;
  /** The most recent error, or null if cleared. */
  lastError: ReplError | null;
  /**
   * Monotonic counter bumped by {@link ReplActionsContextValue.reloadPreview}.
   * `<ReplPreview/>` reads it as the iframe's `key` so a bump forces a full
   * unmount/remount → fresh `TransformClient` and cold boot.
   *
   * @internal
   */
  previewReloadKey: number;
};

export type ReplActionsContextValue = {
  /** Logical entry path (snapshotted on first mount). */
  entry: string;
  /** Vendor bundle (snapshotted on first mount). */
  vendor: VendorBundle;
  /** swc-wasm URL override (snapshotted on first mount). */
  swcWasmUrl: string | undefined;
  /** Optional file pre-processor (snapshotted on first mount). */
  loader: ReplLoader | undefined;
  /**
   * Inline virtual modules (alias → source). Snapshotted on first mount.
   * Always defined; defaults to `{}` when the consumer didn't pass any.
   * Both the engine (`<ReplPreview/>`) and the editor (`<EditorHost/>`)
   * consume this directly — the engine prefixes synthetic registry keys
   * internally.
   */
  virtualModules: VirtualModules;
  /**
   * Optional consumer-provided shell source. Snapshotted on first mount.
   * `<ReplPreview/>` injects this (or a generated default) as the synthetic
   * `ReplShell.tsx` file the iframe actually mounts. `undefined` means use
   * the default. See {@link ReplProviderProps.shell}.
   */
  shell: string | undefined;
  /**
   * Optional consumer-provided extension → editor-language-id mapping.
   * Snapshotted on first mount. {@link EditorHost} consults this before
   * the built-in extension dispatch.
   */
  languages: LanguageMap | undefined;

  setActivePath: (path: string) => void;
  setFile: (path: string, source: string) => void;
  removeFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  /**
   * Force a full cold boot of the preview iframe — drops the current
   * `TransformClient`, remounts the iframe, and re-runs every transform.
   * Use it as a recovery hatch when user code crashes the runtime past
   * what HMR can rescue (e.g. an empty entry file, a top-level throw).
   * Also clears {@link ReplStateContextValue.lastError}.
   */
  reloadPreview: () => void;

  /** Internal — `<ReplPreview/>` flushes errors here for `useRepl()` consumers. */
  setLastError: (err: ReplError | null) => void;
};

export const ReplStateContext = createContext<ReplStateContextValue | null>(null);
export const ReplActionsContext = createContext<ReplActionsContextValue | null>(null);
