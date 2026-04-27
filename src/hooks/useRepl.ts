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
};

export function useRepl(): UseReplReturn {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) {
    throw new Error('useRepl must be used inside a <ReplProvider/>');
  }
  return {
    files: state.files,
    setFile: actions.setFile,
    removeFile: actions.removeFile,
    renameFile: actions.renameFile,
  };
}
