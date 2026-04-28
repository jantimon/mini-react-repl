/**
 * Manifest fed to `scripts/build-default-vendor.mjs` to produce the inlined
 * default vendor (`src/vendor-default/data.ts`). Mirrors the shape end users
 * write for their own custom vendor.
 *
 * Not a published subpath — only consumed by the in-repo build script.
 */

export * from './vendor-base.ts';

import * as dateFns from 'date-fns';
import * as dayjs from 'dayjs';
import * as lodashEs from 'lodash-es';

export { dateFns as 'date-fns', dayjs, lodashEs as 'lodash-es' };
