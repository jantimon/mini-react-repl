import { useState } from 'react';
import { Repl, type Files } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import 'mini-react-repl/theme.css';

import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

// User code: returns a promise on first render to demonstrate the Suspense
// boundary the shell installs around it.
const INITIAL: Files = {
  'App.tsx': `import { use } from 'react';

const greeting = new Promise<string>((r) => setTimeout(() => r('hello from suspense'), 800));

export default function App() {
  const text = use(greeting);
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>{text}</h1>
    </main>
  );
}
`,
};

// Shell source — compiled and run *inside* the iframe alongside user code.
// Wraps the consumer-facing entry (App.tsx) in a Suspense boundary so user
// code that uses `use()` / `lazy()` / `<Suspense>`-aware data libs has
// somewhere to fall back to. Hoist as a top-level const: `<Repl/>` snapshots
// it on first mount.
const SHELL = `import { Suspense } from 'react'
import App from './App'

export default function ReplShell() {
  return (
    <Suspense fallback={<div style={{ padding: 24, opacity: 0.6 }}>Loading…</div>}>
      <App />
    </Suspense>
  )
}
`;

export function App() {
  const [files, setFiles] = useState<Files>(INITIAL);
  return (
    <Repl
      files={files}
      onFilesChange={setFiles}
      vendor={defaultVendor}
      editor={MonacoReplEditor}
      shell={SHELL}
      swcWasmUrl={swcWasmUrl}
    />
  );
}
