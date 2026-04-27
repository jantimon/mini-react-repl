import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
});
