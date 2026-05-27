/**
 * The curated default vendor bundle.
 *
 * Both the import map and the matching `.d.ts` payload are wired through
 * dynamic `import()` so consumer bundlers code-split each into its own
 * chunk. Routes that never mount `<Repl/>` ship neither; preview-only
 * consumers never pay for types.
 *
 * Sizes (inlined as base64 data URLs):
 *   - import map  ~150 kB gzipped JS
 *   - types       ~100 kB gzipped JSON
 *
 * Includes: react, react-dom (+`react-dom/client`), react/jsx-runtime,
 * react/jsx-dev-runtime, react-refresh/runtime, date-fns, dayjs, lodash-es.
 *
 * @example
 * ```ts
 * // recommended: pass the constant directly. The library invokes the lazy
 * // thunks on `<Repl/>` mount (importMap) and `<EditorHost/>` mount (types)
 * // so the chunks load when actually needed.
 * import { defaultVendor } from 'mini-react-repl/vendor-default'
 * <Repl vendor={defaultVendor} ... />
 *
 * // optional: code-split the whole `vendor-default` subpath too
 * <Repl vendor={import('mini-react-repl/vendor-default')} ... />
 *
 * // optional: prefetch a chunk on hover, idle, etc.
 * import { loadVendorImportMap, loadVendorTypes } from 'mini-react-repl/vendor-default'
 * button.addEventListener('pointerover', () => {
 *   void loadVendorImportMap();
 *   void loadVendorTypes();
 * })
 * ```
 *
 * @see {@link build} for producing a custom vendor
 *
 * @public
 */

import type { ImportMap, TypeBundle, VendorBundle } from '../types.ts';

/**
 * Lazily load the default vendor's import map as a separate chunk.
 *
 * Bundlers code-split the dynamic import below, so the import-map JSON is
 * not shipped as part of `mini-react-repl/vendor-default`'s static bundle.
 * The library invokes this from `<ReplProvider/>` when `<Repl/>` first
 * mounts; consumers can also call it directly to warm the chunk (prefetch
 * on hover, idle-time, etc.).
 *
 * SSR-safe: short-circuits to an empty import map on the server so the
 * chunk is not pulled into the SSR bundle.
 */
export const loadVendorImportMap = (): Promise<{ default: ImportMap }> =>
  typeof window === 'undefined'
    ? Promise.resolve({ default: { imports: {} } })
    : import(/* webpackChunkName: "mini-react-repl-import-map" */ './data-import-map.js');

/**
 * Lazily load the default vendor's `.d.ts` payload as a separate chunk.
 *
 * Bundlers code-split the dynamic import below, so the types JSON is not
 * shipped as part of `mini-react-repl/vendor-default`'s static bundle.
 * The library invokes this from `<EditorHost/>` when an editor with a
 * TypeScript service first mounts; consumers can also call it directly
 * to warm the chunk (prefetch on hover, idle-time, etc.).
 *
 * SSR-safe: short-circuits to an empty type bundle on the server so the
 * chunk is not pulled into the SSR bundle.
 */
export const loadVendorTypes = (): Promise<{ default: TypeBundle }> =>
  typeof window === 'undefined'
    ? Promise.resolve({ default: { libs: [] } })
    : import(/* webpackChunkName: "mini-react-repl-types" */ './data-types.js');

export const defaultVendor: VendorBundle = {
  importMap: loadVendorImportMap,
  types: loadVendorTypes,
};

export default defaultVendor;
