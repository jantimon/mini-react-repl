import { lazy, Suspense, useState } from 'react';
import { Repl, type Files } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import type { ElementPick } from 'mini-react-repl/inspect';
import 'mini-react-repl/theme.css';

import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

// Pages visitors who never toggle inspect shouldn't pay for the picker
// runtime on initial load. `wantInspect` flips once on first toggle and
// stays true so the chunk isn't re-fetched.
const InspectMode = lazy(() => import('mini-react-repl/inspect'));

const HELLO: Files = {
  'App.tsx': `import { Card } from './Card';
import { TodoList } from './TodoList';

export default function App() {
  return (
    <main style={{
      padding: 24,
      fontFamily: 'ui-sans-serif, system-ui',
      maxWidth: 480,
      margin: '0 auto',
    }}>
      <Card title="Welcome">
        <p>Toggle <strong>Inspect element</strong> in the toolbar, then click anything in this preview to jump to its source.</p>
      </Card>
      <TodoList items={[
        'Try inspect mode',
        'Edit code on the left — the preview hot-reloads',
        'Add a new file in the file tree',
      ]} />
    </main>
  );
}
`,
  'Card.tsx': `import type { ReactNode } from 'react';

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 20,
      marginBottom: 16,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}
`,
  'TodoList.tsx': `import { useState } from 'react';

export function TodoList({ items }: { items: string[] }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setDone((d) => {
      const next = new Set(d);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((text, i) => (
        <li
          key={i}
          onClick={() => toggle(i)}
          style={{
            padding: 12,
            marginBottom: 6,
            borderRadius: 8,
            background: done.has(i) ? '#dcfce7' : '#f3f4f6',
            cursor: 'pointer',
            textDecoration: done.has(i) ? 'line-through' : 'none',
            userSelect: 'none',
          }}
        >
          {text}
        </li>
      ))}
    </ul>
  );
}
`,
};

export function App() {
  const [files, setFiles] = useState<Files>(HELLO);
  const [wantInspect, setWantInspect] = useState(false);
  const [active, setActive] = useState(false);
  const [lastPick, setLastPick] = useState<ElementPick | null>(null);

  const onToggleInspect = () => {
    setWantInspect(true);
    setActive((a) => !a);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '10px 20px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <strong style={{ fontSize: 16 }}>mini-react-repl</strong>
          <span style={{ color: '#6b7280', fontSize: 13 }}>browser-only React TSX REPL</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onToggleInspect}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
              background: active ? '#2563eb' : '#fff',
              color: active ? '#fff' : '#0f172a',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {active ? 'Inspecting… (Esc to cancel)' : 'Inspect element'}
          </button>
          <a
            href="https://github.com/jantimon/mini-react-repl"
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              color: '#0f172a',
              textDecoration: 'none',
              fontSize: 13,
            }}
          >
            GitHub
          </a>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Repl
          files={files}
          onFilesChange={setFiles}
          vendor={defaultVendor}
          editor={MonacoReplEditor}
          swcWasmUrl={swcWasmUrl}
        >
          {wantInspect && (
            <Suspense fallback={null}>
              <InspectMode
                active={active}
                onElementPicked={(pick) => {
                  setLastPick(pick);
                  setActive(false);
                }}
                onCancel={() => setActive(false)}
              />
            </Suspense>
          )}
        </Repl>
      </div>

      {lastPick && <PickPanel pick={lastPick} onClose={() => setLastPick(null)} />}
    </div>
  );
}

function PickPanel({ pick, onClose }: { pick: ElementPick; onClose: () => void }) {
  const top = pick.stack[0];
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        maxWidth: 360,
        background: '#0f172a',
        color: '#f1f5f9',
        borderRadius: 8,
        padding: '12px 14px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>&lt;{pick.dom.tag}&gt;</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 0,
            color: '#94a3b8',
            cursor: 'pointer',
            padding: '2px 6px',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          close
        </button>
      </div>
      {top ? (
        <>
          <div>{top.componentName ?? '(no component)'}</div>
          <div style={{ color: '#94a3b8' }}>
            {top.fileName}:{top.lineNumber}:{top.columnNumber}
          </div>
        </>
      ) : (
        <div style={{ color: '#94a3b8' }}>(no source frames)</div>
      )}
    </div>
  );
}
