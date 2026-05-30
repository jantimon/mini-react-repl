import { useState } from 'react';
import { Repl, type Files, type VirtualModules } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import 'mini-react-repl/theme.css';

// Self-host swc-wasm: Vite emits this as a hashed asset in build, and serves
// it during dev. Avoids any CDN dependency and makes tests deterministic.
import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

// Hoist to a top-level const so the reference stays stable across renders.
// `<Repl/>` snapshots this on first mount and ignores later identity changes.
const VIRTUAL_MODULES: VirtualModules = {
  '@foo/utils': `export const exclaim = (s: string): string => s + '!'`,
  '@foo/bar': `import { exclaim } from '@foo/utils';
export const greet = (name: string): string => exclaim('hello ' + name);`,
};

const INITIAL: Files = {
  'App.tsx': `import { greet } from '@foo/bar';

export default function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>{greet('world')}</h1>
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
      editor={MonacoReplEditor}
      virtualModules={VIRTUAL_MODULES}
      swcWasmUrl={swcWasmUrl}
    />
  );
}
