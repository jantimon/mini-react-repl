import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // Worker output at dist/worker.js so `new URL('./worker.js', import.meta.url)`
    // inside dist/index.js resolves correctly.
    worker: 'src/engine/worker.ts',
    'editor-monaco/index': 'src/editor-monaco/index.tsx',
    'vendor-default/index': 'src/vendor-default/index.ts',
    'vendor-builder/build': 'src/vendor-builder/build.ts',
    'vendor-builder/cli': 'src/vendor-builder/cli.ts',
    'preview-html': 'src/preview-html.ts',
  },
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: [
    'react',
    'react-dom',
    'react-dom/client',
    'monaco-editor',
    '@swc/wasm-web',
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
});
