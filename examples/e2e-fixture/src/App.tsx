import { useEffect, useRef, useState } from 'react';
import { Repl, type Files, type ReplError, type VendorBundle } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import { InspectMode, type ElementPick } from 'mini-react-repl/inspect';
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

// In ?test mode we inject a small listener into the iframe so e2e can verify
// that host → iframe postMessage works via `iframeRef`. Lives only when the
// query param is present so production bundles aren't affected.
const TEST_BODY_HTML = `<div id="ext-msg" data-testid="ext-msg"></div>
<script>
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (d && d.type === '__ext_test__') {
      var el = document.getElementById('ext-msg');
      if (el) el.textContent = String(d.payload);
    }
  });
</script>`;

export function App() {
  const [files, setFiles] = useState<Files>(HELLO);
  const [lastError, setLastError] = useState<ReplError | null>(null);
  const [inspectActive, setInspectActive] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isTestMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test');
  const isSlowVendor =
    isTestMode && new URLSearchParams(window.location.search).has('slowVendor');

  // ?slowVendor simulates a code-split / late-fetched vendor: build a
  // never-resolved promise on first mount and let Playwright drive the
  // transition via `window.__resolveVendor` / `__rejectVendor`. The
  // initializer is PURE (no window writes) so it survives StrictMode's
  // double-invocation of useState initializers — the resolver is exposed
  // from a useEffect below using the actually-stored state's handles.
  type SlowVendor = {
    promise: Promise<{ default: VendorBundle }>;
    resolve: () => void;
    reject: (msg?: string) => void;
  };
  const [slowVendor] = useState<SlowVendor | null>(() => {
    if (!isSlowVendor) return null;
    let resolveFn!: () => void;
    let rejectFn!: (msg?: string) => void;
    const promise = new Promise<{ default: VendorBundle }>((resolve, reject) => {
      resolveFn = () => resolve({ default: defaultVendor });
      rejectFn = (msg = 'simulated vendor failure') => reject(new Error(msg));
    });
    return { promise, resolve: resolveFn, reject: rejectFn };
  });
  const vendorProp: VendorBundle | Promise<{ default: VendorBundle }> =
    slowVendor?.promise ?? defaultVendor;

  useEffect(() => {
    if (!slowVendor) return;
    const w = window as unknown as {
      __resolveVendor?: () => void;
      __rejectVendor?: (msg?: string) => void;
    };
    w.__resolveVendor = slowVendor.resolve;
    w.__rejectVendor = slowVendor.reject;
    return () => {
      delete w.__resolveVendor;
      delete w.__rejectVendor;
    };
  }, [slowVendor]);

  // Test hook: when ?test is in the URL, expose imperative actions on
  // window so Playwright can drive the file table without typing into Monaco.
  useEffect(() => {
    if (!isTestMode) return;
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
      // Forwards via the new <ReplPreview iframeRef> API so e2e can verify
      // host → iframe postMessage end-to-end.
      postToIframe: (payload: unknown) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return false;
        win.postMessage({ type: '__ext_test__', payload }, '*');
        return true;
      },
      hasIframeRef: () => Boolean(iframeRef.current),
      setInspectActive: (next: boolean) => setInspectActive(next),
      // Inspect-mode hooks — used by tests/e2e/inspect.spec.ts. The matching
      // <InspectMode/> below stashes its picks on `window.__lastPick` for e2e tests to verify
      getLastPick: () => (window as unknown as { __lastPick?: unknown }).__lastPick ?? null,
    };
  }, [lastError, isTestMode]);

  return (
    <Repl
      files={files}
      onFilesChange={setFiles}
      vendor={vendorProp}
      editor={MonacoReplEditor}
      swcWasmUrl={swcWasmUrl}
      onPreviewError={setLastError}
      iframeRef={iframeRef}
      {...(isTestMode ? { bodyHtml: TEST_BODY_HTML } : {})}
    >
      <InspectMode
        active={inspectActive}
        onElementPicked={(pick: ElementPick) => {
          (window as unknown as { __lastPick: ElementPick }).__lastPick = pick;
          setInspectActive(false);
        }}
        onCancel={() => setInspectActive(false)}
      />
    </Repl>
  );
}
