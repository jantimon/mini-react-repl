/**
 * Hook for reading the file table and CRUD actions from the surrounding
 * {@link ReplProvider}.
 *
 * Re-renders whenever the parent's `files` prop changes. Action functions
 * are stable across renders (memoized in the provider) — safe to put in
 * `useEffect` / `useCallback` deps.
 *
 * @example
 * ```ts
 * const { files, setFile } = useRepl()
 * // files: { 'App.tsx': '...' }
 * setFile('App.tsx', 'export default () => <h1>edited</h1>')
 * ```
 *
 * @throws if used outside a `<ReplProvider/>`
 *
 * @public
 */

import { useContext } from 'react';
import { ReplActionsContext, ReplStateContext } from '../components/context.ts';
import type { Files } from '../types.ts';

export type UseReplReturn = {
  /** Current file table (read-only snapshot). */
  files: Files;
  /** Set or replace a file. Path must end in `.tsx`, `.ts`, `.jsx`, `.js`, or `.css`. */
  setFile: (path: string, source: string) => void;
  /** Remove a file. No-op if the path doesn't exist. */
  removeFile: (path: string) => void;
  /**
   * Rename a file. Throws synchronously if `newPath` already exists.
   * @throws if `newPath` collides with an existing file
   */
  renameFile: (oldPath: string, newPath: string) => void;
  /** Currently selected file path in the editor. */
  activePath: string | null;
  /** Set the active file in the editor. No-op if the path doesn't exist. */
  setActivePath: (path: string) => void;
  /**
   * Force a full cold boot of the preview iframe. Use this as a recovery
   * hatch when user code crashes the runtime past what Fast Refresh can
   * rescue — e.g. an empty entry file, a top-level throw, or a corrupted
   * module graph. Drops the current `TransformClient`, remounts the
   * iframe, re-runs every transform, and clears the last error.
   *
   * Cheap but not free: a cold boot re-walks every file through swc-wasm
   * and wipes any in-iframe state your app had built up. Don't use it
   * for ordinary re-renders.
   */
  reloadPreview: () => void;
};

export function useRepl(): UseReplReturn {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) {
    throw new Error('useRepl must be used inside a <ReplProvider/>');
  }
  return {
    activePath: state.activePath,
    files: state.files,
    setFile: actions.setFile,
    setActivePath: actions.setActivePath,
    removeFile: actions.removeFile,
    renameFile: actions.renameFile,
    reloadPreview: actions.reloadPreview,
  };
}
