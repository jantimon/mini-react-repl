/**
 * Resolve a {@link Resolvable} into either a sync value or a Promise.
 *
 * Sync inputs (plain `T` already in hand) return `T` so callers can avoid
 * a microtask hop. Anything else — thunk, Promise, JSON-import default-
 * wrapper — flattens to `Promise<T>`. Used by `<ReplProvider/>` for the
 * import map and by `<EditorHost/>` for vendor types.
 *
 * @internal
 */

import type { Resolvable } from '../types.ts';

/**
 * Recursively resolve a `Resolvable<T>` to `T`. Returns sync when the chain
 * is sync; `Promise<T>` otherwise. Callers in render-paths use
 * `isPlain(v) ? v : resolveValue(v)` to avoid an unnecessary microtask.
 */
export function resolveValue<T>(
  input: Resolvable<T>,
  isPlain: (v: unknown) => v is T,
): T | Promise<T> {
  if (isPlain(input)) return input;
  const stepped = unfunc(input);
  if (isPlain(stepped)) return stepped;
  if (isThenable<T | { default: T }>(stepped)) {
    return Promise.resolve(stepped).then((v) => {
      if (isPlain(v)) return v;
      if (hasDefaultProp<T>(v)) return v.default;
      return v as T;
    });
  }
  // A thunk returned another Resolvable — recurse. Rare but valid.
  return Promise.resolve(resolveValue(stepped as Resolvable<T>, isPlain));
}

const isThenable = <T>(v: unknown): v is PromiseLike<T> =>
  v != null && typeof (v as { then?: unknown }).then === 'function';

const hasDefaultProp = <T>(v: unknown): v is { default: T } =>
  typeof v === 'object' && v !== null && 'default' in (v as object);

/**
 * Unwrap one level: if `v` is a thunk, invoke it; otherwise return as-is.
 * Repeats are handled by recursion at the public {@link resolveValue} entry.
 */
const unfunc = <T>(v: Resolvable<T>): T | PromiseLike<T | { default: T }> | Resolvable<T> =>
  typeof v === 'function' ? (v as () => Resolvable<T>)() : v;
