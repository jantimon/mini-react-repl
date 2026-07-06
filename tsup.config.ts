import { readFile } from 'node:fs/promises';
import type { Plugin } from 'esbuild';
import { defineConfig, type Options } from 'tsup';

// Swap `./create-worker.ts` imports for the bare `#create-worker` specifier,
// resolved by consumers through the conditional `imports` entry in
// package.json: browsers get the real `new Worker(new URL(...))` module,
// Node/SSR bundles get the throwing stub — so server-targeted bundlers never
// see the worker or the swc wasm behind it. Source keeps the relative import
// so tsc/vitest/editors resolve it without extra config.
const externalizeCreateWorker: Plugin = {
  name: 'externalize-create-worker',
  setup(build) {
    build.onResolve({ filter: /^\.\/create-worker\.ts$/ }, (args) => {
      if (args.kind === 'entry-point') return null;
      return { path: '#create-worker', external: true };
    });
  },
};

// @swc/wasm-web's init glue defaults its wasm location to
// `new URL('wasm_bg.wasm', import.meta.url)`. Our worker always passes an
// explicit URL, so the branch is dead — but once the glue is inlined into
// dist/worker.js the relative URL points at a file this package doesn't ship,
// and bundlers that statically resolve `new URL(..., import.meta.url)`
// (webpack, Rspack, Vite) fail the *consumer's* build on it. Replace the
// fallback with a throw. Erroring when the pattern is missing is the point:
// an @swc/wasm-web bump that reshapes the glue must fail our build, not
// silently reintroduce the broken URL.
const stripSwcWasmUrlFallback: Plugin = {
  name: 'strip-swc-wasm-url-fallback',
  setup(build) {
    build.onLoad({ filter: /@swc[\\/]wasm-web[\\/]wasm\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const fallback = "module_or_path = new URL('wasm_bg.wasm', import.meta.url);";
      if (!source.includes(fallback)) {
        throw new Error(
          `strip-swc-wasm-url-fallback: expected wasm URL fallback not found in ${args.path} — ` +
            'the @swc/wasm-web glue changed shape; update the pattern so the dead ' +
            '`new URL` cannot leak back into dist/worker.js.',
        );
      }
      return {
        contents: source.replace(
          fallback,
          "throw new Error('@swc/wasm-web init requires an explicit wasm URL (mini-react-repl always passes one)');",
        ),
        loader: 'js',
      };
    });
  },
};

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
      // inside dist/create-worker.js resolves correctly.
      worker: 'src/engine/worker.ts',
      // Conditional pair behind the `#create-worker` imports entry: browsers
      // get the worker constructor, Node/SSR bundles get the throwing stub.
      // Both live at the dist root so the relative worker URL stays valid.
      'create-worker': 'src/engine/create-worker.ts',
      'create-worker.node': 'src/engine/create-worker.node.ts',
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
      'cdn-esmsh': 'src/cdn-esmsh.ts',
      loader: 'src/loader.ts',
    },
    sourcemap: true,
    // Force-bundle into `dist/worker.js`. tsup externalizes all `dependencies`
    // by default; without this, the worker keeps a bare `import ... from
    // '@swc/wasm-web'` that consumer bundlers (Rolldown in particular) inline
    // verbatim into a `data:` URL where bare specifiers can't resolve.
    noExternal: ['@swc/wasm-web'],
    esbuildPlugins: [externalizeCreateWorker, stripSwcWasmUrlFallback],
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
