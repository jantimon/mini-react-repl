import { useState } from 'react';
import { Repl, type Files } from 'mini-react-repl';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import 'mini-react-repl/theme.css';

// optional: self-host swc-wasm (see README for details)
import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

// optional: dedicated file for the
import initialAppSource from './initial/App.tsx?raw';

const HELLO: Files = {
  'App.tsx': initialAppSource,
};

export function App() {
  const [files, setFiles] = useState<Files>(HELLO);

  return (
    <Repl
      files={files}
      onFilesChange={setFiles}
      vendor={import('./vendor/repl.vendor.json')}
      editor={MonacoReplEditor}
      swcWasmUrl={swcWasmUrl}
    />
  );
}
