/**
 * The curated default vendor bundle.
 *
 * Inlined as base64 data URLs so it works under iframe srcdoc with no
 * static-hosting setup on the consumer side. The cost (~hundreds of kB
 * un-gzipped) is paid only when this subpath is imported.
 *
 * Includes: react, react-dom (+`react-dom/client`), react/jsx-runtime,
 * react/jsx-dev-runtime, react-refresh/runtime, date-fns, dayjs, lodash-es.
 *
 * @example
 * ```ts
 * // sync (eager)
 * import { defaultVendor } from 'mini-react-repl/vendor-default'
 * <Repl vendor={defaultVendor} ... />
 *
 * // async (code-split — pass the dynamic import directly)
 * <Repl vendor={import('mini-react-repl/vendor-default')} ... />
 * ```
 *
 * @see {@link build} for producing a custom vendor
 *
 * @public
 */

import { DEFAULT_VENDOR } from './data.ts';

export { DEFAULT_VENDOR as defaultVendor };
export default DEFAULT_VENDOR;
