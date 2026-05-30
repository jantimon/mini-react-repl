import { useState } from 'react';
import { Repl, type Files } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { createEsmShCdnHandler } from 'mini-react-repl/cdn-esmsh';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import 'mini-react-repl/theme.css';

// Self-host swc-wasm so the engine itself needs no CDN — only the user's
// lazy `import` reaches esm.sh.
import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

// Built once at module scope: `cdn` is a stable reference, so a parent
// re-render never tears down the preview session. Pin the version so the
// lazy import is reproducible across sessions and CI.
const cdnHandler = createEsmShCdnHandler({ versions: { 'canvas-confetti': '1.9.3' } });

const INITIAL: Files = {
  'App.tsx': `// 'canvas-confetti' is not in the curated vendor set — it is lazy-loaded
// from esm.sh on demand, the first time this module evaluates. Everything
// else (react, the editor, swc-wasm) stays local and offline.
import confetti from 'canvas-confetti';
import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Lazy npm via esm.sh</h1>
      <button onClick={() => { confetti(); setCount((c) => c + 1); }}>
        🎉 fired {count}×
      </button>
    </main>
  );
}
`,
};

export function App() {
  const [files, setFiles] = useState<Files>(INITIAL);

  return (
    <Repl
      files={files}
      onFilesChange={setFiles}
      vendor={defaultVendor}
      cdn={cdnHandler}
      editor={MonacoReplEditor}
      swcWasmUrl={swcWasmUrl}
    />
  );
}
