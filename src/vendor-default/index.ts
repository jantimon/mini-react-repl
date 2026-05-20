/**
 * The curated default vendor bundle.
 *
 * Inlined as base64 data URLs so it works under iframe srcdoc with no
 * static-hosting setup on the consumer side. The runtime cost (~150 kB
 * gzipped JS) is paid only when this subpath is imported.
 *
 * The matching `.d.ts` payload (~100 kB gzipped) lives in a separate
 * code-split chunk and is **lazily fetched** by {@link loadVendorTypes} —
 * the library invokes it from `<EditorHost/>` only when an editor adapter
 * mounts. Preview-only / non-Monaco consumers never download it.
 *
 * Includes: react, react-dom (+`react-dom/client`), react/jsx-runtime,
 * react/jsx-dev-runtime, react-refresh/runtime, date-fns, dayjs, lodash-es.
 *
 * @example
 * ```ts
 * // sync (eager — types still load lazily when the editor mounts)
 * import { defaultVendor } from 'mini-react-repl/vendor-default'
 * <Repl vendor={defaultVendor} ... />
 *
 * // async (code-split — pass the dynamic import directly)
 * <Repl vendor={import('mini-react-repl/vendor-default')} ... />
 *
 * // advanced: prefetch the types chunk on hover, idle, etc.
 * import { loadVendorTypes } from 'mini-react-repl/vendor-default'
 * button.addEventListener('pointerover', () => { void loadVendorTypes(); })
 * ```
 *
 * @see {@link build} for producing a custom vendor
 *
 * @public
 */

import { DEFAULT_VENDOR_IMPORT_MAP } from './data.ts';
import type { TypeBundle, VendorBundle } from '../types.ts';

/**
 * Lazily load the default vendor's `.d.ts` payload as a separate chunk.
 *
 * Bundlers code-split the dynamic import below, so the types JSON is not
 * shipped as part of `mini-react-repl/vendor-default`'s static bundle.
 * The library invokes this from `<EditorHost/>` when an editor with a
 * TypeScript service first mounts; consumers can also call it directly
 * to warm the chunk (prefetch on hover, idle-time, etc.).
 *
 * Returns the dynamic-import shape `{ default: TypeBundle }`; both the
 * library and direct callers may forward this Promise to `vendor.types`,
 * which already handles the `{ default }` unwrap.
 */
export const loadVendorTypes = (): Promise<{ default: TypeBundle }> => import('./data-types.js');

export const defaultVendor: VendorBundle = {
  importMap: DEFAULT_VENDOR_IMPORT_MAP,
  types: loadVendorTypes,
};

export default defaultVendor;
