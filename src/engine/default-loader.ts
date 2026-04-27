/**
 * The built-in {@link ReplLoader}. Implements the historic dispatch:
 *
 *   - `.css`                          → injected as a `<style>` tag
 *   - `.tsx` / `.ts` / `.jsx` / `.js` → swc-compiled module
 *   - anything else                   → ignored
 *
 * Used automatically when no `loader` prop is passed. Custom loaders that
 * only want to handle a few extensions can delegate everything else to this:
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
 *
 * @public
 */

import type { ReplLoader } from '../types.ts';
import { isCodeFile, isCssFile } from './path-utils.ts';

export const defaultLoader: ReplLoader = async ({ path, source, transform }) => {
  if (isCssFile(path)) return { kind: 'css', source };
  if (!isCodeFile(path)) return null;
  const tsx = path.endsWith('.tsx') || path.endsWith('.jsx');
  const code = await transform(source, { tsx });
  return { kind: 'module', code };
};
