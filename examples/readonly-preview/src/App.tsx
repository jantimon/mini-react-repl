import { useState } from 'react';
import { ReplProvider, ReplPreview, type Files } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import 'mini-react-repl/theme.css';

import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

/**
 * A docs-style embedded example: readers run the code, they don't write it.
 * There's no editor here at all — just `<ReplProvider hmr={false}>` wrapping a
 * `<ReplPreview/>`, which is the whole point of the `hmr` prop. Fast Refresh
 * would be dead weight in the compiled output of code nobody edits.
 *
 * Picking a different example swaps `files` wholesale, which re-boots the
 * preview. That's the documented trade-off of `hmr={false}` and exactly what
 * you want here: each example should start from a clean slate anyway.
 */
const EXAMPLES: { name: string; files: Files }[] = [
  {
    name: 'Counter',
    files: {
      'App.tsx': `import { useState } from 'react';

export default function App() {
  const [n, setN] = useState(0);
  return (
    <main style={{ padding: 24 }}>
      <h1>Counter</h1>
      <button onClick={() => setN(n + 1)}>count: {n}</button>
    </main>
  );
}
`,
    },
  },
  {
    name: 'Greeting',
    files: {
      'App.tsx': `import { Hello } from './Hello';

export default function App() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Greeting</h1>
      <Hello name="world" />
    </main>
  );
}
`,
      'Hello.tsx': `export function Hello({ name }: { name: string }) {
  return <p>hello, {name}</p>;
}
`,
    },
  },
];

export function App() {
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<Files>(EXAMPLES[0]!.files);

  const pick = (next: number): void => {
    setIndex(next);
    setFiles(EXAMPLES[next]!.files);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div role="tablist" aria-label="Examples" style={{ display: 'flex', gap: 8, padding: 12 }}>
        {EXAMPLES.map((example, i) => (
          <button
            key={example.name}
            role="tab"
            aria-selected={i === index}
            onClick={() => pick(i)}
            style={{ fontWeight: i === index ? 700 : 400 }}
          >
            {example.name}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* `files` is still controlled — the reader just never edits it. */}
        <ReplProvider
          files={files}
          onFilesChange={setFiles}
          vendor={defaultVendor}
          swcWasmUrl={swcWasmUrl}
          hmr={false}
        >
          <ReplPreview />
        </ReplProvider>
      </div>
    </div>
  );
}
