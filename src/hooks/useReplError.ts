/**
 * Hook for reading the most recent transform / runtime / resolve error from
 * the surrounding {@link ReplProvider}.
 *
 * Split from {@link useRepl} so file-editing UIs that don't care about
 * errors don't re-render every time an error appears or clears.
 *
 * @example
 * ```ts
 * const { lastError } = useReplError();
 * if (lastError?.kind === 'runtime') reportToSentry(lastError);
 * ```
 *
 * @throws if used outside a `<ReplProvider/>`
 *
 * @public
 */

import { useContext } from 'react';
import { ReplErrorContext } from '../components/context.ts';
import type { ReplError } from '../types.ts';

export type UseReplErrorReturn = {
  /** The most recent error, or `null` after a successful reload / `reloadPreview()`. */
  lastError: ReplError | null;
};

export function useReplError(): UseReplErrorReturn {
  const ctx = useContext(ReplErrorContext);
  if (!ctx) throw new Error('useReplError must be used inside a <ReplProvider/>');
  return ctx;
}
