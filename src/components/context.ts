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
import type { Files, VendorBundle, ReplError } from '../types.ts';

export type ReplStateContextValue = {
  /** Current file table (mirrors the consumer's `files` prop). */
  files: Files;
  /** Currently selected file path in the editor. */
  activePath: string | null;
  /** The most recent error, or null if cleared. */
  lastError: ReplError | null;
};

export type ReplActionsContextValue = {
  /** Logical entry path (snapshotted on first mount). */
  entry: string;
  /** Vendor bundle (snapshotted on first mount). */
  vendor: VendorBundle;
  /** swc-wasm URL override (snapshotted on first mount). */
  swcWasmUrl: string | undefined;

  setActivePath: (path: string) => void;
  setFile: (path: string, source: string) => void;
  removeFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;

  /** Internal — `<ReplPreview/>` flushes errors here for `useRepl()` consumers. */
  setLastError: (err: ReplError | null) => void;
};

export const ReplStateContext = createContext<ReplStateContextValue | null>(null);
export const ReplActionsContext = createContext<ReplActionsContextValue | null>(null);
