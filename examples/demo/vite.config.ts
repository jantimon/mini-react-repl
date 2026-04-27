import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/mini-react-repl/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    // Monaco needs special handling. We let Vite pre-bundle the main
    // editor entry; workers come in via the new URL trick below.
    include: ['monaco-editor/esm/vs/editor/editor.api'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        // Isolate large vendors into their own chunks. Prevents top-level
        // var-name collisions between React's module symbols (e.g.
        // `Symbol.for('react.suspense')`) and esbuild-helper functions
        // (`__toESM`/`__copyProps`) that, when minified into the same
        // chunk, both reduce to the same name and overwrite each other
        //
        // TODO: Verify with newer Rollup versions if this is still necessary
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
