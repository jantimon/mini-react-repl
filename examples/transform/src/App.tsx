import { useState } from 'react';
import {
  Repl,
  defaultLoader,
  type Files,
  type ReplLoader,
  type TypeBundle,
  type VendorBundle,
} from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import 'mini-react-repl/theme.css';

// Teach Monaco's TypeScript service what `import x from './foo.md'` means.
// Without this it reports TS2307 ("Cannot find module") on every loader-
// handled file.
//
// Registered through `vendor.types` — the same pipeline the default vendor
// uses for `react`, `date-fns`, etc. Each entry is a `.d.ts` source string
// keyed by the URI Monaco should register it under.
const LOADER_AMBIENT_TYPES = `
  declare module '*.md' {
    import type { ComponentType } from 'react';
    const Component: ComponentType;
    export default Component;
  }
`;

// `vendor.types` is typed as `TypeBundle | PromiseLike<...>` since custom
// vendors may resolve types asynchronously. The default vendor inlines them
// synchronously, so we narrow before merging.
const baseTypes = defaultVendor.types as TypeBundle | undefined;

const vendor: VendorBundle = {
  ...defaultVendor,
  types: {
    libs: [
      ...(baseTypes?.libs ?? []),
      { path: 'file:///loader-ambient.d.ts', content: LOADER_AMBIENT_TYPES },
    ],
  },
};

// Custom loader. One custom file type plus delegation:
//   .md  → generated TSX, compiled via the same swc-wasm pipeline the
//          default loader uses for .tsx files
//   else → defaultLoader (so .tsx / .css still behave normally)
const loader: ReplLoader = async (input) => {
  if (input.path.endsWith('.md')) {
    // Trivial markdown: `# heading` → <h1>, blank-line-separated paragraphs
    // → <p>. We hand the source to the runtime as a string and do the
    // splitting in JSX, which keeps the generated TSX small and lets us
    // showcase `input.transform()` (it has to compile <h1>/<p> to React.createElement).
    const tsx = `
      const SOURCE = ${JSON.stringify(input.source)};
      export default function MarkdownDoc() {
        const blocks = SOURCE.split(/\\n{2,}/).map((b) => b.trim()).filter(Boolean);
        return (
          <article style={{ lineHeight: 1.5 }}>
            {blocks.map((block, i) =>
              block.startsWith('# ')
                ? <h1 key={i} style={{ marginTop: 0 }}>{block.slice(2)}</h1>
                : <p key={i}>{block}</p>
            )}
          </article>
        );
      }
    `;
    return {
      kind: 'module',
      code: await input.transform(tsx, { tsx: true }),
    };
  }

  return defaultLoader(input);
};

const INITIAL: Files = {
  'App.tsx': `import Notes from './Notes.md';

export default function App() {
  return (
    <main style={{ padding: 24 }}>
      <Notes />
    </main>
  );
}
`,
  'Notes.md': `# Custom loaders

Edit any file on the left and the preview updates.

The .md file doesn't have built-in support — it's handled by a small
loader passed to <Repl loader={...}/>.
`,
};

export function App() {
  const [files, setFiles] = useState<Files>(INITIAL);
  return (
    <Repl
      files={files}
      onFilesChange={setFiles}
      vendor={vendor}
      editor={MonacoReplEditor}
      loader={loader}
      languages={{ md: 'markdown' }}
    />
  );
}
