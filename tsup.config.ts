import { defineConfig } from 'tsup';

export default defineConfig({
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
    // Browser-targeted default export
    'vendor-default/index': 'src/vendor-default/index.ts',
    'vendor-base': 'src/vendor-base.ts',
    'vendor-builder/build': 'src/vendor-builder/build.ts',
    'vendor-builder/cli': 'src/vendor-builder/cli.ts',
    'preview-html': 'src/preview-html.ts',
  },
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  // Code splitting extracts shared internals (e.g. `ReplActionsContext`) into
  // common chunks so that React contexts created once in the main entry are
  // the *same* context the optional `./inspect` subpath consumes — without it,
  // each subpath inlines its own duplicate `createContext()` call and
  // `useContext()` returns the default value across subpath boundaries.
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
  // Force-bundle into `dist/worker.js`. tsup externalizes all `dependencies`
  // by default; without this, the worker keeps a bare `import ... from
  // '@swc/wasm-web'` that consumer bundlers (Rolldown in particular) inline
  // verbatim into a `data:` URL where bare specifiers can't resolve.
  noExternal: ['@swc/wasm-web'],
});
