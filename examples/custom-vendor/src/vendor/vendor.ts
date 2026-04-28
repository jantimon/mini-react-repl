/**
 * Custom-vendor manifest. Each named export becomes an import-map key in
 * the iframe; the `import * as` source is the npm package that gets bundled.
 *
 *   pnpm build:vendor
 *
 * which expands to:
 *   repl-vendor-build src/vendor/vendor.ts --out public/vendor \
 *     --bundle-out src/vendor/repl.vendor.json
 *
 * JS chunks + repl.types.json land in public/vendor/ (served at /vendor/*).
 * The bundler-imported import-map JSON lands next to this file at
 * src/vendor/repl.vendor.json so App.tsx can `import` it directly.
 */

// React + react-dom + react-refresh + jsx-runtime — required for the iframe
// runtime to boot. Skip this re-export and the build fails loudly.
export * from 'mini-react-repl/vendor-base';

// Pick whatever your demo actually imports. Add comments — knip and
// reviewers can both see why each entry is here.

import * as nanoid from 'nanoid'; // tiny id generator used in the demo list

export { nanoid };
