/**
 * Custom-vendor manifest. Each named export becomes an import-map key in
 * the iframe; the `import * as` source is the npm package that gets bundled.
 *
 *   pnpm build:vendor
 *
 * which expands to:
 *   repl-vendor-build src/vendor.entry.ts
 *
 * Output is the sibling folder src/vendor.generated/ containing index.ts +
 * import-map.json + types.json. App.tsx imports the customVendor named
 * export from the folder; the generated index.ts wires lazy types via
 * dynamic import, so the bundler code-splits types into their own chunk.
 */

// React + react-dom + react-refresh + jsx-runtime — required for the iframe
// runtime to boot. Skip this re-export and the build fails loudly.
export * from 'mini-react-repl/vendor-base';

// Pick whatever your demo actually imports. Add comments — knip and
// reviewers can both see why each entry is here.

import * as nanoid from 'nanoid'; // tiny id generator used in the demo list

export { nanoid };
