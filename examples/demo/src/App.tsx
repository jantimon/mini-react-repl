import { useEffect, useState } from 'react';
import { Repl, type Files, type ReplError } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import 'mini-react-repl/theme.css';

// Self-host swc-wasm: Vite emits this as a hashed asset in build, and serves
// it during dev. Avoids any CDN dependency and makes tests deterministic.
import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

const HELLO: Files = {
  'App.tsx': `import { format } from 'date-fns';
import { Counter } from './Counter';

export default function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Today is {format(new Date(), 'eeee')}</h1>
      <Counter />
    </main>
  )
};
`,
  'Counter.tsx': `import { useState } from 'react';

export function Counter() {
  const [n, setN] = useState(0);
  return (
    <button
      data-testid="counter"
      onClick={() => setN((x) => x + 1)}
      style={{
        padding: '8px 12px',
        borderRadius: 6,
        border: '1px solid #cdd',
        background: '#f7f7f8',
        cursor: 'pointer',
      }}
    >
      count: {n}
    </button>
  )
};
`,
};

export function App() {
  const [files, setFiles] = useState<Files>(HELLO);
  const [lastError, setLastError] = useState<ReplError | null>(null);

  // Test hook: when ?test is in the URL, expose imperative actions on
  // window so Playwright can drive the file table without typing into Monaco.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('test')) return;
    (window as unknown as { __replTest__: unknown }).__replTest__ = {
      setFile: (path: string, source: string) => setFiles((f) => ({ ...f, [path]: source })),
      removeFile: (path: string) =>
        setFiles((f) => {
          const next = { ...f };
          delete next[path];
          return next;
        }),
      renameFile: (oldPath: string, newPath: string) =>
        setFiles((f) => {
          const next: Files = {};
          for (const [k, v] of Object.entries(f)) next[k === oldPath ? newPath : k] = v;
          return next;
        }),
      reset: () => setFiles(HELLO),
      getError: () => lastError,
      // Lazy-import monaco so production bundles don't drag the test API in.
      getMarkers: async (path: string) => {
        const monaco = await import('monaco-editor');
        return monaco.editor.getModelMarkers({
          resource: monaco.Uri.parse(`file:///workspace/${path}`),
        });
      },
    };
  }, [lastError]);

  return (
    <Repl
      files={files}
      onFilesChange={setFiles}
      vendor={defaultVendor}
      editor={MonacoReplEditor}
      swcWasmUrl={swcWasmUrl}
      onPreviewError={setLastError}
    />
  );
}
