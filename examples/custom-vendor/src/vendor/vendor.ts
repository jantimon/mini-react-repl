/**
 * Custom-vendor manifest. Each named export becomes an import-map key in
 * the iframe; the `import * as` source is the npm package that gets bundled.
 *
 *   pnpm build:vendor
 *
 * which expands to:
 *   repl-vendor-build src/vendor/vendor.ts --out src/vendor/repl.vendor.json
 *
 * Output is a single JSON file with `data:` URLs for every vendor entry,
 * imported directly by App.tsx — no static-hosting setup required.
 */

// React + react-dom + react-refresh + jsx-runtime — required for the iframe
// runtime to boot. Skip this re-export and the build fails loudly.
export * from 'mini-react-repl/vendor-base';

// Pick whatever your demo actually imports. Add comments — knip and
// reviewers can both see why each entry is here.

import * as nanoid from 'nanoid'; // tiny id generator used in the demo list

export { nanoid };
