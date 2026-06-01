import { useRef, useState } from 'react';
import { Repl, type Files, type ReplError, type VendorBundle } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import { InspectMode, type ElementPick } from 'mini-react-repl/inspect';
import 'mini-react-repl/theme.css';

// Self-host swc-wasm: Vite emits this as a hashed asset in build, and serves
// it during dev. Avoids any CDN dependency and makes tests deterministic.
import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

const HELLO: Files = {
  'App.tsx': `import dayjs from 'dayjs';
import { Counter } from './Counter';
import { Inbox } from './Inbox';

export default function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Today is {dayjs().format('dddd')}</h1>
      <Counter />
      <Inbox />
    </main>
  )
};
`,
  'Counter.tsx': `import { useState } from 'react';

export function Counter() {
  const [n, setN] = useState(0);
  return (
    <button
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
  'Inbox.tsx': `import { useEffect, useState } from 'react';

// Demonstrates host → preview messaging via the <Repl iframeRef> prop: the
// host posts a message into the sandbox and this component renders it.
export function Inbox() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'host-message') setMessage(String(event.data.payload));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return message ? <p role="status">from host: {message}</p> : null;
}
`,
};

// A promise-typed `vendor` demonstrates the pending-state contract added in
// 0.13.0: the bundle resolves only after an async signal. The `?slowVendor`
// mode wires it to a `/__vendor-gate__` request, which e2e drives via
// `page.route` (200 to resolve, 503 to reject) — no window hooks, just a
// realistic "vendor fetched after a gate" pattern. Hoisted to module scope so
// the reference is stable and the gate fetch fires once, not per render.
const isSlowVendor =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('slowVendor');

const vendor: VendorBundle | Promise<{ default: VendorBundle }> = isSlowVendor
  ? fetch('/__vendor-gate__').then((res) => {
      // A failed gate rejects the vendor promise with a recognizable reason so
      // e2e can assert the library forwards it into its console diagnostic.
      if (!res.ok) throw new Error('vendor gate failed');
      return { default: defaultVendor };
    })
  : defaultVendor;

export function App() {
  const [files, setFiles] = useState<Files>(HELLO);
  const [inspectActive, setInspectActive] = useState(false);
  const [lastPick, setLastPick] = useState<ElementPick | null>(null);
  const [lastError, setLastError] = useState<ReplError | null>(null);
  const [message, setMessage] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setInspectActive((on) => !on)}>
          {inspectActive ? 'Inspecting…' : 'Inspect'}
        </button>
        <input
          aria-label="Message to preview"
          placeholder="message to preview"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'host-message', payload: message },
              '*',
            )
          }
        >
          Send to preview
        </button>
        {lastPick && (
          <span role="status">
            picked &lt;{lastPick.dom.tag}&gt; “{lastPick.dom.text}” from{' '}
            {lastPick.stack[0]?.fileName}:{lastPick.stack[0]?.lineNumber} in{' '}
            {lastPick.stack[0]?.componentName}
          </span>
        )}
        {/* Echo the `onPreviewError` payload into a host live region so e2e can
            assert the prop fires (the in-preview overlay is the runtime's own
            channel; this proves the callback, too). `role="log"` is distinct
            from the pick's `status` and the overlay's `alert`. */}
        {lastError && <span role="log">preview error: {lastError.kind}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Repl
          files={files}
          onFilesChange={setFiles}
          vendor={vendor}
          editor={MonacoReplEditor}
          swcWasmUrl={swcWasmUrl}
          iframeRef={iframeRef}
          onPreviewError={setLastError}
        >
          <InspectMode
            active={inspectActive}
            onElementPicked={(pick: ElementPick) => {
              setLastPick(pick);
              setInspectActive(false);
            }}
            onCancel={() => setInspectActive(false)}
          />
        </Repl>
      </div>
    </div>
  );
}
