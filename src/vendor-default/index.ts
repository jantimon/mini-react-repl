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
 * import { defaultVendor } from 'mini-react-repl/vendor-default'
 * <Repl vendor={defaultVendor} ... />
 * ```
 *
 * @see {@link build} for producing a custom vendor
 *
 * @public
 */

export { DEFAULT_VENDOR as defaultVendor } from './data.ts';
