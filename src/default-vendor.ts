/**
 * Manifest fed to `scripts/build-default-vendor.mjs` to produce the inlined
 * default vendor (`src/vendor-default/data.ts`). Mirrors the shape end users
 * write for their own custom vendor.
 *
 * Not a published subpath — only consumed by the in-repo build script.
 */

export * from './vendor-base.ts';

import * as dayjs from 'dayjs';

export { dayjs };
