/**
 * Manifest of the iframe-runtime required core. Re-export from your own
 * `vendor.ts` to satisfy the import-map keys the in-iframe runtime + every
 * SWC-transformed JSX file hard-import:
 *
 * ```ts
 * // vendor.ts
 * export * from 'mini-react-repl/vendor-base';
 *
 * import * as zod from 'zod';
 * export { zod };
 * ```
 *
 * Then `repl-vendor-build vendor.ts --out public/vendor --bundle-out src/vendor/repl.vendor.json`.
 *
 * @public
 */

import * as react from 'react';
import * as reactDom from 'react-dom';
import * as reactDomClient from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — types may not be published; runtime API is stable.
import * as reactRefreshRuntime from 'react-refresh/runtime';

export {
  react,
  reactDom as 'react-dom',
  reactDomClient as 'react-dom/client',
  jsxRuntime as 'react/jsx-runtime',
  jsxDevRuntime as 'react/jsx-dev-runtime',
  reactRefreshRuntime as 'react-refresh/runtime',
};
