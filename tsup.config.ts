import { defineConfig, type Options } from 'tsup';

const shared = {
  format: ['esm'],
  target: 'es2022',
  dts: true,
  splitting: true,
  treeshake: true,
  external: [
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'monaco-editor',
    'es-module-lexer',
    'react-refresh/runtime',
    'esbuild',
    'fs',
    'path',
    'url',
    'node:fs',
    'node:path',
    'node:url',
    'node:fs/promises',
  ],
} satisfies Options;

// Two passes, run in parallel by tsup. The split lets the vendor-default
// pass skip sourcemap generation: that bundle's only payload is two large
// JSON blobs wrapped as ES module chunks, where a sourcemap is ~2 MB of
// unreachable VLQ that just maps the JSON back to itself. The main pass
// keeps sourcemaps for actual TS sources.
//
// `clean` is handled by scripts/clean-dist.mjs in the npm build script, not
// here — running it on one pass would race the other (tsup's array configs
// run via Promise.all).
export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      // Worker output at dist/worker.js so `new URL('./worker.js', import.meta.url)`
      // inside dist/index.js resolves correctly.
      worker: 'src/engine/worker.ts',
      'editor-monaco/index': 'src/editor-monaco/index.tsx',
      // SSR no-op stub. Selected by the `node` export condition so that
      // server-side bundlers don't pull in monaco-editor (which touches
      // `window` at module init).
      'editor-monaco/index.node': 'src/editor-monaco/index.node.tsx',
      // Optional element-picker subpath. Imports trace-mapping but only as a
      // type — the picker bundle inlines it for the iframe side.
      'inspect/index': 'src/inspect/index.ts',
      'vendor-base': 'src/vendor-base.ts',
      'vendor-builder/cli': 'src/vendor-builder/cli.ts',
      'preview-html': 'src/preview-html.ts',
      loader: 'src/loader.ts',
    },
    sourcemap: true,
    // Force-bundle into `dist/worker.js`. tsup externalizes all `dependencies`
    // by default; without this, the worker keeps a bare `import ... from
    // '@swc/wasm-web'` that consumer bundlers (Rolldown in particular) inline
    // verbatim into a `data:` URL where bare specifiers can't resolve.
    noExternal: ['@swc/wasm-web'],
  },
  {
    ...shared,
    entry: {
      // Browser-targeted default vendor. Pre-built `import-map.json` and
      // `types.json` get code-split via dynamic imports into their own chunks
      // (`dist/import-map-*.js`, `dist/types-*.js`) so consumer bundlers can
      // defer them until <Repl/> mounts.
      'vendor-default/index': 'src/vendor-default/index.ts',
    },
    sourcemap: false,
  },
]);
