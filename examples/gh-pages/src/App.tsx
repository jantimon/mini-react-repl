import { lazy, Suspense, useEffect, useState } from 'react';
import { Repl, type Files } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { createEsmShCdnHandler } from 'mini-react-repl/cdn-esmsh';
import type { ElementPick } from 'mini-react-repl/inspect';
import 'mini-react-repl/theme.css';
import { FocusableMonacoEditor, revealEditorLine } from './FocusableMonacoEditor';

import swcWasmUrl from '@swc/wasm-web/wasm_bg.wasm?url';

// Built once at module scope so `cdn` is a stable reference — a parent
// re-render never tears down the preview session. `canvas-confetti` isn't in
// the curated vendor set, so it's lazy-loaded from esm.sh the first time
// ConfettiButton.tsx evaluates; the version is pinned for reproducibility.
const cdnHandler = createEsmShCdnHandler({ versions: { 'canvas-confetti': '1.9.3' } });

// Pages visitors who never toggle inspect shouldn't pay for the picker
// runtime on initial load. `wantInspect` flips once on first toggle and
// stays true so the chunk isn't re-fetched.
const InspectMode = lazy(() => import('mini-react-repl/inspect'));

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function SunIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </svg>
  );
}

function InspectIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" />
      <path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
    </svg>
  );
}

function StopInspectIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

const ICON_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 6,
  borderRadius: 6,
  cursor: 'pointer',
  lineHeight: 0,
};

const HELLO: Files = {
  'App.tsx': `import { Card } from './Card';
import { TodoList } from './TodoList';
import { ConfettiButton } from './ConfettiButton';

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
        <ConfettiButton />
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
  'ConfettiButton.tsx': `// 'canvas-confetti' is not in the curated vendor import map — it is
// lazy-loaded from esm.sh on demand the first time this module evaluates.
// Everything else (react, the editor, swc-wasm) stays local and offline.
import confetti from 'canvas-confetti';
import { useState } from 'react';

export function ConfettiButton() {
  const [count, setCount] = useState(0);
  return (
    <button
      onClick={() => {
        confetti();
        setCount((c) => c + 1);
      }}
      style={{
        marginTop: 12,
        padding: '8px 14px',
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        background: '#f3f4f6',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      🎉 fired {count}×
    </button>
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
  const [activePath, setActivePath] = useState<string | null>('App.tsx');
  const [wantInspect, setWantInspect] = useState(false);
  const [active, setActive] = useState(false);
  const [lastPick, setLastPick] = useState<ElementPick | null>(null);

  const onToggleInspect = () => {
    setWantInspect(true);
    setActive((a) => !a);
  };

  const onElementPicked = (pick: ElementPick) => {
    setLastPick(pick);
    setActive(false);
    // Walk the owner chain for the first frame whose source file we know
    // about; vendor / virtual frames don't appear in the file tabs and
    // can't be revealed.
    const top = pick.stack.find((f) => f.fileName in files);
    if (!top) return;
    setActivePath(top.fileName);
    revealEditorLine(top.fileName, top.lineNumber, top.columnNumber);
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
          borderBottom: '1px solid light-dark(#e2e3e7, #22242a)',
          background: 'light-dark(#f3f4f6, #15161a)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <strong style={{ fontSize: 16 }}>mini-react-repl</strong>
          <span style={{ color: 'light-dark(#9aa, #667)', fontSize: 12 }}>v{__REPL_VERSION__}</span>
          <span style={{ color: 'light-dark(#4b5563, #aab)', fontSize: 13 }}>
            browser-only React TSX REPL
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeToggle />
          <button
            type="button"
            onClick={onToggleInspect}
            aria-label={active ? 'Stop inspecting (Esc to cancel)' : 'Inspect element'}
            title={active ? 'Stop inspecting (Esc to cancel)' : 'Inspect element'}
            style={{
              ...ICON_BUTTON_STYLE,
              border: `1px solid ${active ? '#2563eb' : 'light-dark(#e2e3e7, #22242a)'}`,
              background: active ? '#2563eb' : 'light-dark(#ffffff, #1a1c20)',
              color: active ? '#ffffff' : 'light-dark(#111111, #e6e7ea)',
            }}
          >
            {active ? <StopInspectIcon /> : <InspectIcon />}
          </button>
          <a
            href="https://github.com/jantimon/mini-react-repl"
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid light-dark(#e2e3e7, #22242a)',
              background: 'light-dark(#ffffff, #1a1c20)',
              color: 'light-dark(#111111, #e6e7ea)',
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
          activePath={activePath}
          onActivePathChange={setActivePath}
          vendor={defaultVendor}
          cdn={cdnHandler}
          editor={FocusableMonacoEditor}
          swcWasmUrl={swcWasmUrl}
        >
          {wantInspect && (
            <Suspense fallback={null}>
              <InspectMode
                active={active}
                onElementPicked={onElementPicked}
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

type Theme = 'light' | 'dark';
const THEME_KEY = 'mini-react-repl:theme';

function readPref(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  if (v === 'light' || v === 'dark') return v;
  // No saved choice yet — seed from the OS so the first paint matches the
  // user's environment. Once they click, that choice is persisted and the
  // OS preference is no longer consulted.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function ThemeToggle() {
  const [pref, setPref] = useState<Theme>(readPref);

  useEffect(() => {
    // `data-theme` selects the unlayered `--repl-*` overrides in index.html
    // so a forced choice beats theme.css's prefers-color-scheme block.
    const root = document.documentElement;
    root.style.colorScheme = pref;
    root.style.setProperty('--repl-color-scheme', pref);
    root.dataset.theme = pref;
    localStorage.setItem(THEME_KEY, pref);
  }, [pref]);

  const next: Theme = pref === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      style={{
        ...ICON_BUTTON_STYLE,
        border: '1px solid light-dark(#e2e3e7, #22242a)',
        background: 'light-dark(#ffffff, #1a1c20)',
        color: 'light-dark(#111111, #e6e7ea)',
      }}
    >
      {pref === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
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
