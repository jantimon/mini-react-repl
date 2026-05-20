import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
);

export default defineConfig({
  base: '/mini-react-repl/',
  define: {
    __REPL_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  server: {
    port: 5176,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['monaco-editor/esm/vs/editor/editor.api'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        // Isolate large vendors into their own chunks. Prevents top-level
        // var-name collisions between React's module symbols and esbuild
        // helpers (`__toESM`/`__copyProps`) that, when minified into the
        // same chunk, both reduce to the same name and overwrite each other.
        manualChunks: (id) => {
          if (id.includes('node_modules/monaco-editor')) return 'monaco';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react';
          }
        },
      },
    },
  },
});
