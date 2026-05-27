/**
 * `mini-react-repl/loader` — the built-in file loader.
 *
 * Exposed under a subpath so consumers who write a custom {@link ReplLoader}
 * can delegate unknown extensions back to it without pulling the import
 * into their root bundle.
 *
 * ```ts
 * import { defaultLoader, type ReplLoader } from 'mini-react-repl/loader';
 *
 * const loader: ReplLoader = async (input) => {
 *   if (input.path.endsWith('.md')) return { kind: 'module', code: ... };
 *   return defaultLoader(input);
 * };
 * ```
 *
 * @public
 */

export { defaultLoader } from './engine/default-loader.ts';
export type { ReplLoader, ReplLoaderInput, ReplLoaderResult } from './types.ts';
