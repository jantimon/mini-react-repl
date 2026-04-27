# `mini-react-repl` — Browser-only React TSX REPL Library

A React library for embedding a multi-file TSX editor and live preview in any
React app. All TypeScript→JS transformation happens client-side in a Web Worker
using swc-wasm. Third-party dependencies are resolved through native Import
Maps from a curated, prebuilt vendor bundle. No backend, no server-side
bundling, fully static-deployable.

This document specifies the **library** itself, plus the demo app under
`examples/`. The library is what gets published to npm; the demo is how we
prove (and showcase) that the library actually works.

---

## 1. Goals & non-goals

### Goals

- **Drop-in React component.** Consumers `npm i mini-react-repl`, render `<Repl/>`
  (or compose headless parts), and get a working editor + preview.
- **Headless-first, with sensible defaults.** Composable parts
  (`<ReplProvider/>`, `<ReplEditor/>`, `<ReplPreview/>`, `<ReplFileTabs/>`,
  `<ReplErrorOverlay/>`) plus a convenience `<Repl/>` that wires them up.
- **Strictly controlled state.** Consumer always owns the file table; no hidden
  internal store. This is non-negotiable for the API.
- **Customizable vendor bundle.** Library ships a default vendor (React +
  date-fns + dayjs + lodash-es) but consumers can replace it with their own.
- **Real React Fast Refresh.** Component state survives edits.
- **Configured editor TS service.** Monaco gets compiler options matching the
  runtime transform (automatic JSX, ES2022, bundler resolution) and consumes
  the vendor bundle's optional `.d.ts` payload (`vendor.types`) so users see
  red squiggles and hover signatures for the curated default set.
- **Modern only.** Chrome 109+, Firefox 108+, Safari 16.4+. No polyfills.
- **Bundler-aware but bundler-light.** Works with any modern ESM-aware bundler
  (Vite, Rollup, Webpack 5+, esbuild). Single setup step: install peer deps.

### Non-goals (v1)

- No persistence helpers, no share-URL helpers, no template helpers, no console
  capture component. Consumers wire their own.
- No `import.meta.hot` API for user code. Refresh handles boundaries
  automatically.
- No full LSP-in-worker. Editor TS diagnostics are scoped to what
  Monaco's in-browser TS service produces, configured by the library, with
  the vendor's `.d.ts` payload registered as extra libs (see §9.2). swc-wasm
  still strips types — diagnostics never gate the transform pipeline.
- No folder structure for user files (flat list).
- No auto-fix on rename/delete.
- No outer Console panel; users open browser DevTools.
- No `useRepl()` events / imperatives in v1 (no `forceRefresh`, no
  `getPreviewIframe`, no `onConsole`). Hook surface is just files + CRUD.
- No bundler-agnostic "no build step" mode (we use bundler-native worker
  imports — see §6.4).

---

## 2. Repository layout

This is a single-package npm publish, but the repo also houses a demo app
and the supporting build tooling:

```
mini-react-repl/                   # the OSS repo
├─ package.json                    # mini-react-repl (the published package)
├─ tsconfig.json
├─ tsup.config.ts                  # or rollup; library build
├─ src/                            # the library source
│  ├─ index.ts                     # public entry: <Repl/>, <ReplProvider/>, hooks
│  ├─ components/
│  │  ├─ Repl.tsx                  # convenience wrapper (default layout)
│  │  ├─ ReplProvider.tsx          # context, holds derived state
│  │  ├─ ReplFileTabs.tsx
│  │  ├─ ReplPreview.tsx           # owns the iframe lifecycle
│  │  └─ ReplErrorOverlay.tsx      # optional; can be rendered standalone
│  ├─ hooks/
│  │  └─ useRepl.ts                # { files, setFile, removeFile, renameFile }
│  ├─ engine/                      # framework-agnostic core
│  │  ├─ transform-client.ts       # main-thread orchestration, debounce
│  │  ├─ worker.ts                 # swc-wasm worker (entry of `?worker` import)
│  │  ├─ import-rewriter.ts        # bare/relative specifier rewrite
│  │  ├─ blob-registry.ts          # logical-path → blob URL map
│  │  └─ refresh-plugin-config.ts  # swc options for Refresh
│  ├─ runtime/                     # ⬇ shipped INTO the iframe srcdoc as a string
│  │  ├─ runtime.ts                # window.__repl__ registry, commit(), refresh hook
│  │  ├─ refresh-runtime.ts        # wraps react-refresh/runtime
│  │  └─ overlay.ts                # in-iframe error overlay DOM
│  ├─ preview-html.ts              # generateSrcdoc({ importMap, headHtml, bodyHtml, runtime })
│  ├─ editor-monaco/               # OPTIONAL editor adapter (separate export)
│  │  ├─ index.tsx                 # <MonacoReplEditor/>
│  │  └─ workers.ts                # Monaco worker setup helper
│  ├─ vendor-default/              # OPTIONAL default vendor (separate export)
│  │  ├─ index.ts                  # exports { importMap, basePath }
│  │  └─ assets/                   # react.js, react-dom.js, date-fns.js, etc.
│  ├─ vendor-builder/              # OPTIONAL CLI + programmatic API (separate export)
│  │  ├─ cli.ts                    # `repl-vendor-build` bin
│  │  └─ build.ts                  # programmatic build({ packages, outDir })
│  └─ theme.css                    # optional default styling
├─ examples/
│  └─ demo/                        # Vite app proving the library works
│     ├─ index.html
│     ├─ src/main.tsx
│     ├─ src/App.tsx               # uses <Repl/> with default vendor
│     └─ vite.config.ts
└─ README.md
```

### `package.json` exports map

```jsonc
{
  "name": "mini-react-repl",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./editor-monaco": {
      "types": "./dist/editor-monaco/index.d.ts",
      "import": "./dist/editor-monaco/index.js",
    },
    "./vendor-default": {
      "types": "./dist/vendor-default/index.d.ts",
      "import": "./dist/vendor-default/index.js",
    },
    "./vendor-builder": {
      "types": "./dist/vendor-builder/build.d.ts",
      "import": "./dist/vendor-builder/build.js",
    },
    "./theme.css": "./dist/theme.css",
    "./preview-html": { "types": "./dist/preview-html.d.ts", "import": "./dist/preview-html.js" },
  },
  "bin": { "repl-vendor-build": "./dist/vendor-builder/cli.js" },
  "peerDependencies": {
    "react": ">=19",
    "react-dom": ">=19",
    "monaco-editor": ">=0.45", // peer of /editor-monaco subpath only
  },
  "peerDependenciesMeta": {
    "monaco-editor": { "optional": true },
  },
}
```

The `monaco-editor` peer is **optional** — consumers using a different editor
never install it.

---

## 3. Public API

### 3.1 Convenience component

```tsx
import { Repl } from 'mini-react-repl'
import { defaultVendor } from 'mini-react-repl/vendor-default'
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco'

const [files, setFiles] = useState({
  'App.tsx': "export default function App(){ return <h1>Hello</h1> }",
})

<Repl
  files={files}
  onFilesChange={setFiles}
  vendor={defaultVendor}
  editor={MonacoReplEditor}            // or any custom editor; required
/>
```

`<Repl/>` is a thin layout: tabs on top, editor on the left, preview on the
right. For any other layout, drop down to the headless parts.

### 3.2 Headless composition

```tsx
import {
  ReplProvider,
  ReplFileTabs,
  ReplPreview,
  ReplErrorOverlay,
  useRepl,
} from 'mini-react-repl';
<ReplProvider files={files} onFilesChange={setFiles} vendor={vendor}>
  <MyLayout>
    <ReplFileTabs />
    <MyEditorAdapter /> {/* consumer's choice of editor */}
    <ReplPreview
      headHtml="<link rel='stylesheet' href='/normalize.css'/>"
      bodyHtml="<div id='extra-mount'/>"
      showPreviewErrorOverlay
      onPreviewError={(err) => toast(err.message)}
    />
  </MyLayout>
</ReplProvider>;
```

### 3.3 Hook

```ts
const { files, setFile, removeFile, renameFile } = useRepl();
//   files:        Record<string, string>   (read-only snapshot)
//   setFile:      (path: string, source: string) => void
//   removeFile:   (path: string) => void
//   renameFile:   (oldPath: string, newPath: string) => void
```

**That is the entire hook surface in v1.** No `errors`, no `status`, no
`forceRefresh`, no `getPreviewIframe`. Consumers who need those wait for v2 or
read them off `<ReplPreview/>`'s `onPreviewError` callback.

### 3.4 Component prop reference

| Component        | Prop                      | Type                       | Default          | Notes                                        |
| ---------------- | ------------------------- | -------------------------- | ---------------- | -------------------------------------------- |
| `<ReplProvider>` | `files`                   | `Record<string,string>`    | — required —     | Strictly controlled.                         |
|                  | `onFilesChange`           | `(next) => void`           | — required —     | Called for every CRUD action.                |
|                  | `vendor`                  | `VendorBundle`             | — required —     | `{ importMap, baseUrl?, types? }`.           |
|                  | `entry`                   | `string`                   | `'App.tsx'`      | Logical path of the entry module.            |
|                  | `transformDebounceMs`     | `number`                   | `150`            |                                              |
| `<ReplPreview>`  | `headHtml`                | `string`                   | `''`             | Injected into iframe `<head>`.               |
|                  | `bodyHtml`                | `string`                   | `''`             | Injected into iframe `<body>` after `#root`. |
|                  | `showPreviewErrorOverlay` | `boolean`                  | `true`           | Toggles built-in overlay.                    |
|                  | `onPreviewError`          | `(err: ReplError) => void` | undefined        | Both transform + runtime errors.             |
|                  | `swcWasmUrl`              | `string`                   | jsdelivr CDN URL | Override for self-hosted swc-wasm.           |
| `<Repl>`         | (all of above)            |                            |                  | Convenience component forwards them.         |
|                  | `editor`                  | React component            | — required —     | E.g. `MonacoReplEditor`.                     |

### 3.5 Error type

```ts
type ReplError =
  | { kind: 'transform'; path: string; message: string; loc?: { line: number; column: number } }
  | { kind: 'runtime'; message: string; stack: string }
  | { kind: 'resolve'; path: string; specifier: string }; // module not found
```

---

## 4. State model: strictly controlled

`<ReplProvider/>` does **not** hold a files store of its own. Every render
reads the `files` prop. Every action calls `onFilesChange` with a fresh object.
`useRepl()` reads the same `files` prop through context.

```ts
function setFile(path, source) {
  onFilesChange({ ...filesProp, [path]: source });
}
function removeFile(path) {
  const next = { ...filesProp };
  delete next[path];
  onFilesChange(next);
}
function renameFile(oldPath, newPath) {
  const next = { ...filesProp };
  next[newPath] = next[oldPath];
  delete next[oldPath];
  onFilesChange(next);
}
```

Implications:

- Consumer is responsible for memoization/debouncing of expensive `onFilesChange`
  side effects.
- Persistence is consumer's job (write `files` to IDB on change).
- Sharing is consumer's job (encode `files` to URL hash on change).
- Undo/redo is consumer's job (stash `files` snapshots).
- The library still debounces _transformation_ internally (150ms), independent
  of the consumer's debouncing of `onFilesChange`.

---

## 5. Vendor bundle: default + override

A consumer always passes `vendor={…}` — the prop is required. The library
ships a default they can pass through, and a builder for custom ones.

### 5.1 The contract

```ts
type VendorBundle = {
  /** Standard import-map JSON: { imports: { 'react': '/vendor/react.js', … } } */
  importMap: { imports: Record<string, string>; scopes?: Record<string, Record<string, string>> };
  /**
   * Optional base. If set, relative paths in importMap.imports are resolved
   * against this URL inside the iframe. Useful when the consumer hosts vendor
   * files at a non-default path.
   */
  baseUrl?: string;
  /**
   * Optional `.d.ts` payload for editors that consume types (Monaco does;
   * editors that don't ignore the field). Produced by the vendor builder
   * with `types: 'embed'`; pre-baked on the default vendor.
   */
  types?: TypeBundle;
};

type TypeBundle = {
  /**
   * Flat list of `.d.ts` files keyed by the URI under which they should be
   * registered. Convention: `file:///node_modules/<pkg>/<entry>.d.ts`.
   */
  libs: Array<{ path: string; content: string }>;
};
```

### 5.2 Default vendor

```ts
import { defaultVendor } from 'mini-react-repl/vendor-default';
//   defaultVendor.importMap → { imports: { 'react': 'data:text/javascript;base64,…', … } }
//   defaultVendor.baseUrl   → undefined (everything is data: URL)
```

The default vendor is **inlined as base64 data URLs** in the published package,
so it works under srcdoc (no consumer-side static hosting needed). This makes
the default install heavy but zero-config — pay the cost only if you `import`
the subpath.

Bundled in default vendor:

- `react@19`, `react-dom@19`, `react-dom/client`
- `react/jsx-runtime`, `react/jsx-dev-runtime`
- `react-refresh/runtime` (used by the in-iframe runtime, not user code)
- `date-fns@3`
- `dayjs@1`
- `lodash-es@4`

Approximate weight: ~400KB minified+gzipped, all base64-inlined. The default
vendor also ships pre-baked `.d.ts` for the same set (~200KB gzipped) under
`vendor.types`, registered with Monaco's TS service when the editor adapter
is `MonacoReplEditor`.

### 5.3 Custom vendor: `mini-react-repl/vendor-builder`

```bash
# CLI:
npx repl-vendor-build \
  --packages react,react-dom,date-fns,zod,my-design-system \
  --out public/vendor \
  --format hosted \         # or 'inline' to emit a JSON of data: URLs
  --types embed             # also collect .d.ts (default 'omit')
```

```ts
// programmatic:
import { build } from 'mini-react-repl/vendor-builder';
const vendor = await build({
  packages: ['react', 'react-dom', 'zod', 'framer-motion'],
  format: 'hosted',
  outDir: 'public/vendor',
  types: 'embed', // also collect .d.ts; default 'omit'
});
//  → emits public/vendor/<pkg>.<hash>.js + types.json
//  → returns { importMap, baseUrl, types }
```

The builder is an esbuild wrapper for the JS, plus a small `.d.ts` walker
for the `types` payload (resolves each package's own types or its
`@types/<name>` fallback, follows transitive references). `format: 'inline'`
produces a single JSON file with base64 data URLs (good for srcdoc
consumers); `format: 'hosted'` produces real files (better for caching).
`types: 'omit'` (default) skips type collection entirely.

### 5.4 Mixing

Consumers can spread to extend the default:

```ts
import { defaultVendor } from 'mini-react-repl/vendor-default';
const myVendor = {
  importMap: {
    imports: {
      ...defaultVendor.importMap.imports,
      zod: '/my-vendor/zod.js',
    },
  },
};
```

---

## 6. The transform pipeline

### 6.1 Worker

`src/engine/worker.ts` runs swc-wasm. Loaded via:

```ts
new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
```

**This is bundler-native.** It works in Vite, Rollup 4+, Webpack 5+,
Parcel 2+, esbuild bundle. **It does not work without a bundler** (no CDN
`<script type="module">` consumption). This is an explicit trade-off we
accept; consumers wanting CDN-only delivery can be served by a future
`mini-react-repl/standalone` build.

swc-wasm itself is fetched at runtime from a CDN by default; consumers can
self-host and pass `swcWasmUrl`.

### 6.2 Debounce + last-good-render

- 150ms idle after last `setFile` call → enqueue transform.
- Worker has at most one in-flight; later requests for the same path supersede.
- On success: post the new module bundle to the iframe.
- On failure: do **not** invalidate the previous module. Surface the error via
  `onPreviewError` and the in-iframe overlay. Last good render stays visible.

### 6.3 swc options

```ts
{
  jsc: {
    parser: { syntax: 'typescript', tsx: true },
    target: 'es2022',
    transform: {
      react: { runtime: 'automatic', development: true, refresh: true },
    },
  },
  sourceMaps: 'inline',
}
```

If swc's built-in `refresh: true` does not inject `$RefreshReg$`/`$RefreshSig$`
calls in a Refresh-runtime-compatible way, fall back to the official
`@swc/plugin-react-refresh` wasm.

### 6.4 Source maps

Inline base64. Survive blob-URL round-trips in all three target browsers.
DevTools Sources panel shows original `.tsx` files; stack traces report
`Counter.tsx:5:3`. Consumer's `onPreviewError` callback receives original-source
line/column.

---

## 7. Module graph in the iframe

Identical model to the standalone version: **blob URLs for execution, logical
paths for identity.** See §6 of the original SPEC for the full mechanics
(registry shape, transformed module wrapper, edit cycle, cascade rules,
entry mounting, bootstrap order). The library packages this into the runtime
string injected into the iframe srcdoc.

Public-API impact: none. The iframe internals are not part of the library's
public surface.

---

## 8. Iframe model

### 8.1 srcdoc, generated per provider mount

`<ReplPreview/>` generates a srcdoc string from:

- `vendor.importMap` (inlined as `<script type="importmap">`)
- `headHtml` prop (consumer extras: fonts, normalize.css, Tailwind, custom globals)
- `bodyHtml` prop (extra DOM after `#root`)
- The bundled runtime (`runtime.js` + refresh runtime + overlay), inlined as a
  module script

The srcdoc is recomputed only when one of those inputs changes — never on
file edits. File edits go through postMessage to the already-mounted iframe.

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    {{ headHtml }}
    <script type="importmap">
      {{ JSON.stringify(importMap) }}
    </script>
    <script type="module">
      {
        {
          runtimeBundle;
        }
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
    {{ bodyHtml }}
  </body>
</html>
```

### 8.2 Trade-offs we accept by choosing srcdoc

- DevTools "Sources" shows files under `about:srcdoc`; mitigated by inline
  source maps so original `.tsx` files still appear.
- Stack traces show `about:srcdoc:42` for the iframe HTML itself, but blob:
  URLs for transformed modules. Acceptable.
- Reload of just the iframe = re-render the srcdoc (consumer can call
  `key={replKey}` on `<ReplPreview/>` to force a reset).

### 8.3 No sandbox attribute by default

Same trust model as before — user editing their own code on their own machine.
A future `sandbox` prop on `<ReplPreview/>` can opt into stricter modes once
shared snippets become a thing.

### 8.4 postMessage protocol

Same shape as the standalone version (§9.2 of original SPEC). Both directions:

- Parent → iframe: `load`, `unload`, `css-upsert`, `css-remove`, `reset`
- Iframe → parent: `ready`, `transform-error`, `runtime-error`, `resolve-error`

The iframe-to-parent error messages drive both the optional in-iframe overlay
and the `onPreviewError` callback.

---

## 9. Editor: headless by default, Monaco optional

### 9.1 Adapter contract

```ts
// imported from 'mini-react-repl'
type ReplEditorProps = {
  path: string                 // current file
  value: string                // current source
  onChange: (next: string) => void
  language: 'typescript' | 'javascript' | 'css'
  types?: TypeBundle           // forwarded from vendor.types; optional
}

// adapters are React components matching this shape:
const MyEditorAdapter: React.FC<ReplEditorProps> = ({ value, onChange, language }) => …
```

The `types` prop carries the surrounding `vendor.types` payload (when set).
Adapters that consume types — `MonacoReplEditor` does — register them with
their TS service. Adapters that don't simply ignore the field; nothing in
the contract requires them to handle it.

Consumers either:

1. Use `MonacoReplEditor` from `mini-react-repl/editor-monaco`.
2. Write their own (CodeMirror, Ace, plain `<textarea>`, custom).

The library does **not** ship Monaco from the main entry. `monaco-editor` is
a peer dep of the `mini-react-repl/editor-monaco` subpath only, declared as
`peerDependenciesMeta.optional`. Consumers using their own editor never install
Monaco at all.

### 9.2 `<MonacoReplEditor/>` behavior

- Imports from `monaco-editor` (peer).
- Configures the worker bootstrap inline (no consumer config required for the
  editor to work — but the consumer's bundler still needs to handle Monaco's
  worker imports, which most modern bundlers do via plugins).
- **Configures Monaco's TypeScript service on mount** with compiler options
  matching the runtime transform: `jsx: ReactJSX`, `target: ES2022`,
  `module: ESNext`, `moduleResolution: Bundler`, plus `strict`,
  `esModuleInterop`, `isolatedModules`, `allowNonTsExtensions`,
  `lib: ['ES2022', 'DOM', 'DOM.Iterable']`. Both syntactic and semantic
  validation are enabled. Without this Monaco's defaults reject every
  `.tsx` file with TS17004 ("--jsx not provided") and every bare specifier
  with TS2792 ("module not found"). Consumers can override via the
  `compilerOptions` and `diagnosticsOptions` passthrough props.
- **Registers `vendor.types`** as Monaco extra libs via
  `monaco.languages.typescript.typescriptDefaults.addExtraLib(content, uri)`.
  Registrations are ref-counted globally so multiple `<MonacoReplEditor/>`
  instances and React StrictMode double-invokes are idempotent.
- Theme: respects `prefers-color-scheme` by default; consumers can pass
  `theme="vs-dark"` etc. as a passthrough prop.

---

## 10. Styling: unstyled primitives + optional theme

Components emit stable class names and data-attributes:

```html
<div class="repl-tabs">
  <button class="repl-tab" data-active="true">App.tsx</button>
  <button class="repl-tab">Counter.tsx</button>
</div>
<div class="repl-preview"><iframe class="repl-iframe" /></div>
<div class="repl-error-overlay">…</div>
```

Class list (stable, semver-bounded):

- `.repl-root` (provider wrapper if any)
- `.repl-tabs`, `.repl-tab[data-active]`, `.repl-tab-add`
- `.repl-editor`
- `.repl-preview`, `.repl-iframe`
- `.repl-error-overlay`, `.repl-error-message`

Consumers either:

- Import `mini-react-repl/theme.css` for sane defaults.
- Style class names themselves.
- Wrap with their own component and pass `className` / `style` (every
  component accepts both).

No CSS-in-JS, no Tailwind dependency in the library itself.

---

## 11. Iframe extras (`headHtml` / `bodyHtml`)

`<ReplPreview/>` accepts two raw HTML strings injected into the generated
srcdoc head and body. Common uses:

```tsx
<ReplPreview
  headHtml={`
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <script src="/tailwind-play.js"></script>
    <script>window.MY_GLOBAL = { apiKey: 'demo' }</script>
  `}
  bodyHtml={`<div id="my-extra-mount"></div>`}
/>
```

Documented caveats:

- Strings are injected verbatim. Consumer is responsible for what they put in.
- The library's import map and runtime script run **after** `headHtml`, so
  consumer scripts in `headHtml` cannot rely on the registry being up.
- Use `bodyHtml` (which renders after `#root`) for anything that needs to run
  after the React root is mounted.

---

## 12. Error UI

Both transform and runtime errors flow through the same `onPreviewError`
callback on `<ReplPreview/>` and (optionally) render into the built-in
overlay.

```tsx
<ReplPreview
  showPreviewErrorOverlay={true} // default true
  onPreviewError={(err) => {
    if (err.kind === 'runtime') sentry.capture(err);
    setLastError(err);
  }}
/>
```

The overlay is a fixed-position element inside the iframe (created by the
runtime). Renders the latest error; auto-shows on new errors; close button
hides until next error. Source-mapped line/column when available.

For a fully custom error UI, consumers set `showPreviewErrorOverlay={false}`
and render whatever they want in their own DOM driven by `onPreviewError`.

`<ReplErrorOverlay/>` is also exported for headless consumers who want the
built-in overlay outside the iframe (e.g. as a sidebar). Not common, but cheap
to support.

---

## 13. CSS files inside user code

Same behavior as the standalone version: alphabetical concatenation across
files, one `<style data-repl-css="…">` per file in the iframe `<head>`,
hot-swap of `textContent` on edit. `@import` not supported. Tailwind is
**not** loaded by default — consumers who want it pass it via `headHtml`
(which is recommended in the `<Repl/>` JSDoc and the README).

---

## 14. Browser support

Chrome 109+, Firefox 108+, Safari 16.4+. No polyfills. Native:

- `<script type="importmap">`
- top-level `await`
- dynamic `import()`
- `structuredClone`

If consumers need older browser support, they ship `es-module-shims`
themselves (the library does not).

---

## 15. The `examples/demo` app

A Vite SPA living in the repo (not published) that exists to:

1. Prove the library works end-to-end.
2. Serve as a reference integration in docs.
3. Run Playwright tests against.

It does:

```tsx
// examples/demo/src/App.tsx
import { Repl } from 'mini-react-repl';
import { defaultVendor } from 'mini-react-repl/vendor-default';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import 'mini-react-repl/theme.css';

const HELLO = { 'App.tsx': 'export default () => <h1>Hello</h1>' };

export default function App() {
  const [files, setFiles] = useState(HELLO);
  return (
    <Repl files={files} onFilesChange={setFiles} vendor={defaultVendor} editor={MonacoReplEditor} />
  );
}
```

That's the entire app. If the demo gets longer than ~50 lines, the library
is missing a default.

---

## 16. Performance budget

Same targets as the standalone version (~180–200ms edit-stop → preview update
on a 2024-class laptop). srcdoc rendering happens once on provider mount;
incremental edits go through postMessage and never re-render the iframe HTML.

---

## 17. Testing strategy

### Unit (vitest)

import-rewriter, blob-registry edge cases, refresh boundary detection, srcdoc
generator, vendor builder.

### End-to-end (Playwright)

- **Browser:** Chromium only for v1. Firefox + WebKit deferred until the
  Chromium suite is stable. The library still _targets_ Chrome 109+ /
  Firefox 108+ / Safari 16.4+ — we just don't gate CI on the other two yet.
- **Target:** the `examples/demo` Vite app, started by Playwright's
  `webServer` config (`vite --port 5173`).
- **Determinism:** `examples/demo/public/swc.wasm` is committed (or fetched in
  global setup) and the demo passes `swcWasmUrl="/swc.wasm"`. No CDN fetch
  during tests.
- **Test hooks:** when the demo is loaded with `?test`, it exposes
  `window.__replTest__.setFile(path, src)` etc. so state-logic tests bypass
  Monaco entirely. Editor-specific tests use real keystrokes against the
  Monaco DOM.
- **Iframe access:** `page.frameLocator('.repl-iframe')` against the srcdoc
  iframe; `expect(...).toHaveText(...)` retries through the 150ms debounce
  window without explicit sleeps.

### E2E test cases (v1)

- Cold render: text appears in iframe.
- Edit `App.tsx`: text updates without flicker.
- Edit `Counter.tsx` with `useState`: counter value preserved across edit
  (Refresh state preservation, the load-bearing test).
- Rename file: overlay shows `Module not found`, previous render stays.
- Syntax error: overlay visible, previous render still mounted (last-good-render).
- Custom `headHtml`: injected element is present inside the iframe.
- Replace vendor: custom import resolves and renders.
- Monaco diagnostics regression: seed `App.tsx` produces no `17004`
  ("`--jsx` not provided") and no `2792` ("module not found") error markers.
- Monaco type acquisition: forcing a date-fns `format(123, …)` call surfaces
  a real TS error (`2769` or `2345`) — proves `vendor.types` is wired
  through to Monaco's TS service end-to-end.

### Other

- No backend tests, no SSR tests.
- Library is published with `tsup`, ESM-only (no CJS) — modern only.

---

## 18. Documentation & comment style

Comments are part of the API. they show up in IDE popovers, autocomplete
descriptions, and generated docs. write them like the user is hovering over
your symbol in VS Code — because that is exactly what's happening.

### 18.1 Tooling

- **TSDoc** — the standard, supported by VS Code, IntelliJ, and TypeDoc out
  of the box. Not free-form JSDoc; we follow the TSDoc spec for tag set and
  parsing.
- **`eslint-plugin-tsdoc`** in the repo eslint config to flag malformed tags.
- **TypeDoc** for generated reference docs. Deferred to v0.2 — we ship hand-
  written README + IDE-surfaced docstrings for v1.

### 18.2 What gets a docstring (and what doesn't)

**Document:**

- every exported value, type, component, hook
- every prop on every exported component
- every field of every exported `type` / `interface`
- non-obvious contracts and invariants ("`files` is the source of truth, no internal store")
- footguns and ordering constraints ("`headHtml` runs before the runtime")
- performance-relevant behavior ("called for every keystroke; debounce yourself")
- edge cases and what they do ("passing the same path twice replaces, not throws")
- cross-references via `@see {@link OtherSymbol}`
- non-trivial usage via `@example`

**Don't document:**

- private helpers — use `@internal` if you have to export them for tests
- what the code does when the name already says it
- restate the type signature in prose ("Takes a string and returns a number" — TS already says that)
- TODO / FIXME — open an issue
- changelog material — that goes in CHANGELOG.md

### 18.3 Voice

- match the README. terse, dev-to-dev, lowercase fragments are fine when readable.
- imperative: "Returns the next state" not "This function returns the next state"
- direct address: "Pass `null` to reset" not "It is possible to pass null to reset"
- don't hedge — if it always throws on `null`, write "Throws if `path` is null", not "May throw under some conditions"

### 18.4 Summary line rule

The first line is what shows in IDE autocomplete dropdowns. **Make it count.**

- one sentence, ≤ 80 chars
- no preamble ("This component renders…", "A function that…")
- it should complete the sentence "This is…" in the reader's head

```ts
/** Drop-in editor + preview component. */ // good
/** This is a component that wraps the editor and preview. */ // bad — preamble
/** @see Repl */ // bad — empty summary
```

Then a blank line, then the long-form. Long-form can be multiple paragraphs;
IDE popovers render the whole thing.

### 18.5 Component layout

````ts
/**
 * Drop-in editor + preview. Default layout (tabs / editor / preview)
 * suitable for embeds and docs.
 *
 * For custom layouts, drop down to the headless parts: {@link ReplProvider},
 * {@link ReplFileTabs}, {@link ReplPreview}.
 *
 * @example
 * ```tsx
 * <Repl
 *   files={files}
 *   onFilesChange={setFiles}
 *   vendor={defaultVendor}
 *   editor={MonacoReplEditor}
 * />
 * ```
 *
 * @see {@link ReplProvider} for headless composition
 * @see {@link useRepl} for the file-table hook
 */
export function Repl(props: ReplProps): JSX.Element { ... }
````

### 18.6 Props / interface fields

Docstring above each field. VS Code surfaces it on hover and in JSX
autocomplete — this is the highest-DX-leverage place to write good prose.

```ts
export type ReplProps = {
  /** Source of truth for the file table. Required — the component is strictly controlled. */
  files: Record<string, string>;

  /**
   * Called for every set / remove / rename action with the next files object.
   * The library does not debounce this — debounce or batch on your side if it
   * triggers expensive work (IDB writes, server sync, history snapshots).
   */
  onFilesChange: (next: Record<string, string>) => void;

  /** Logical path of the entry module. @defaultValue `'App.tsx'` */
  entry?: string;

  /**
   * Inline HTML injected into the iframe `<head>`, **before** the import map
   * and runtime script. Don't depend on `window.__repl__` here — for code
   * that needs the React root mounted, use {@link ReplProps.bodyHtml}.
   *
   * @defaultValue `''`
   */
  headHtml?: string;

  /**
   * Self-hosted swc-wasm URL. Set this for offline use, strict CSP, or CI
   * determinism.
   *
   * @defaultValue jsdelivr CDN URL pinned to the supported swc version
   */
  swcWasmUrl?: string;
};
```

### 18.7 Hooks

Document **what it returns**, **when it re-renders**, and **what's stable
across renders** (so consumers know what's safe in dep arrays):

```ts
/**
 * Reads the file table from the surrounding {@link ReplProvider} and returns
 * CRUD actions.
 *
 * Re-renders whenever the parent's `files` prop changes. Action functions
 * (`setFile`, `removeFile`, `renameFile`) are stable across renders — safe
 * to put in `useEffect` / `useCallback` deps.
 *
 * @throws if used outside a `<ReplProvider/>`
 */
export function useRepl(): UseReplReturn { ... }
```

### 18.8 Errors and throws

If a function throws, document **when** with `@throws`:

```ts
/**
 * @throws {InvalidPathError} if `path` is empty or contains `..`
 * @throws {DuplicatePathError} if `newPath` already exists
 */
```

If it returns an error union (preferred over throwing), document the
non-success arms in the `@returns`:

```ts
/**
 * @returns the resolved blob URL, or `{ kind: 'resolve-error', specifier }`
 *   if the import map has no entry for `specifier`
 */
```

### 18.9 Lifecycle tags

- `@beta` — public API, signature may change before v1.
- `@experimental` — even less stable than `@beta`. Off by default; behind a flag.
- `@deprecated since 0.4 — use {@link newThing}` — always with a replacement.
  Removed in the next major after deprecation.
- `@internal` — exported for tests or type composition. Not part of the
  public contract. Consumers who reach for these are on their own.

### 18.10 Examples

`@example` blocks are the most-read part of any docstring. follow these:

- prefer **complete, runnable** snippets over fragments
- show the **import line** for non-obvious symbols
- use **realistic** values, not `foo` / `bar`
- one example per `@example` block; multiple blocks are fine

````ts
/**
 * @example Basic usage
 * ```tsx
 * import { defaultVendor } from 'mini-react-repl/vendor-default'
 * <Repl files={files} onFilesChange={setFiles} vendor={defaultVendor} editor={MonacoReplEditor} />
 * ```
 *
 * @example Custom vendor
 * ```tsx
 * import { build } from 'mini-react-repl/vendor-builder'
 * const vendor = await build({ packages: ['react', 'zod'], format: 'inline' })
 * ```
 */
````

### 18.11 What we explicitly don't do

- **no `@type {…}` JSDoc.** TypeScript types are the source of truth. If a
  comment and a type disagree, they're both wrong — fix the type.
- **no `@author`, `@since` on individual symbols.** Git blame and CHANGELOG
  cover these.
- **no banner comments** (`// ============= Helpers =============`). They add
  zero information; if a file needs section dividers it's too long.
- **no commented-out code.** Delete it. Git remembers.
- **no apologies** ("ugly hack", "I know this is bad"). State the constraint
  factually instead, with the issue link.

### 18.12 Internal (non-exported) code

Inside the library, **prefer fewer comments and better names**. Exception:
when the _why_ is non-obvious — a workaround for a known issue, an invariant
the type system can't express, an ordering constraint with another module.
Then one short line saying _why_, with an issue link if there is one.

```ts
// runs synchronously before commit() so registry sees the new module
// before refresh hooks fire — see #42
moduleRecord.exports = exports;
```

Internal code does **not** appear in IDE popovers, so the "tutorial in
JSDoc" temptation doesn't apply. One line, on the line above the code,
only when it earns its keep.

### 18.13 Worked example: a complete file

````ts
import type { VendorBundle } from './types';

/**
 * The curated default vendor bundle.
 *
 * Inlined as base64 data URLs so it works under iframe srcdoc with no
 * static-hosting setup on the consumer side. ~400KB gzipped — the cost is
 * paid only when this subpath is imported.
 *
 * Includes: react@19, react-dom@19, react/jsx-runtime, date-fns@3, dayjs@1,
 * lodash-es@4, plus react-refresh runtime (used internally by the iframe
 * runtime, not exposed to user code).
 *
 * @example
 * ```ts
 * import { defaultVendor } from 'mini-react-repl/vendor-default'
 * <Repl vendor={defaultVendor} ... />
 * ```
 *
 * @see {@link build} for producing a custom vendor
 */
export const defaultVendor: VendorBundle = {
  importMap: {
    imports: {
      /* … */
    },
  },
};
````

---

## 19. Open items / deferred to v2

- **`mini-react-repl/standalone`** build for no-bundler / CDN consumption. Would
  need a self-instantiating worker (Blob trick) instead of bundler-native
  worker imports.
- **`useRepl()` event/imperative surface.** `errors`, `status`,
  `forceRefresh()`, `getPreviewIframe()`, `onConsole` event.
- **Helper subpath packages.** Persistence (IDB), share-URL codecs,
  templates, console-panel component.
- **Folder structure** for user files.
- **Full LSP-in-worker** via `@typescript/vfs` + `tsserver` for richer
  diagnostics, refactors, and `.d.ts` for arbitrary user-installed packages.
  v1 ships Monaco's built-in TS service plus the vendor's pre-baked `.d.ts`
  (see §9.2) — that covers the curated default but doesn't extend to
  arbitrary npm.
- **Asset imports** (images, JSON).
- **Cross-origin sandbox / shared-link safety mode.**
- **CodeMirror editor adapter.**
- **`@repl/core`** split if a non-React framework adapter is wanted.

---

## 20. Decision log

Library-shape decisions (the new ones from this round) on top, original
playground decisions below for completeness.

### Library shape

| Decision                | Choice                                                                                                                       | Rejected because                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Package layout          | Single `mini-react-repl` package with subpath exports (`/editor-monaco`, `/vendor-default`, `/vendor-builder`, `/theme.css`) | Monorepo split adds maintenance overhead with no v1 consumer demand.                                           |
| State ownership         | Strictly controlled — consumer always passes `files` + `onFilesChange`                                                       | Hybrid hides state; pure imperative is un-React-y.                                                             |
| Vendor ownership        | Library ships a default + accepts override                                                                                   | Pure-CDN breaks offline; consumer-only forces a build step on every demo.                                      |
| Composition             | Headless parts + convenience `<Repl/>`                                                                                       | Headless-only requires too much glue for typical use; convenience-only doesn't scale to embeds.                |
| Preview HTML            | srcdoc with inlined HTML                                                                                                     | Static-file approach forces consumers to copy a file per bundler; blob URL has spotty cross-browser behavior.  |
| Worker delivery         | Bundler-native `new Worker(new URL('./worker.js', import.meta.url))`                                                         | Inline-Blob trick adds CSP friction; explicit `workerUrl` shifts setup to consumer.                            |
| Editor coupling         | Headless by default; `MonacoReplEditor` exposed via separate import path so it's only bundled when imported                  | Hard-bundling Monaco bloats every consumer; pure-headless leaves zero-config users stranded.                   |
| Styling                 | Unstyled primitives + optional `theme.css`                                                                                   | Bundled CSS can't be themed; CSS-in-JS adds a build dep; Tailwind is opinionated.                              |
| Iframe extras           | `headHtml` / `bodyHtml` raw-string slot props on `<ReplPreview/>`                                                            | Structured options grow forever; transformer fn is a footgun.                                                  |
| Error UI                | `showPreviewErrorOverlay` + `onPreviewError` props on `<ReplPreview/>` (forwarded by `<Repl/>`)                              | Hook-only loses zero-config UX; default-only blocks customization.                                             |
| Headless hook surface   | `files` + `setFile` / `removeFile` / `renameFile` only                                                                       | Errors and imperatives expand the contract before we know what's actually needed.                              |
| Helper modules          | None in v1                                                                                                                   | Each helper is a separate design problem; ship core first, helpers when there's pull.                          |
| Editor type-acquisition | `vendor.types` slot + `MonacoReplEditor` registers with `addExtraLib`; default vendor pre-bakes types for the curated set    | Doing nothing leaves Monaco shouting `17004`/`2792` over correct code; full LSP-in-worker is too heavy for v1. |

### Playground / runtime decisions (carried over)

| Decision           | Choice                                                                   | Rejected because                                                          |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Transformer        | swc-wasm                                                                 | esbuild-wasm has no Refresh plugin; Sucrase has TS gaps; Babel too slow.  |
| Transform location | Worker, 150ms debounce, last-good-render                                 | Main-thread blocks editor; per-keystroke is wasteful; on-save feels dead. |
| Module resolution  | Blob URLs + logical-path registry                                        | SW adds lifecycle complexity; single-bundle loses HMR.                    |
| HMR                | Real React Fast Refresh                                                  | Module-only loses state; full reload feels broken.                        |
| TS tooling         | Erasure only                                                             | LSP-in-worker is heavy and out of scope for v1.                           |
| Browser floor      | Chrome 109+, Firefox 108+, Safari 16.4+, no polyfills                    | Polyfills add complexity for users we don't need to reach.                |
| `import.meta.hot`  | Not exposed                                                              | Refresh's heuristics are sufficient for v1.                               |
| Rename/delete      | Break naturally, surface via overlay + `onPreviewError`                  | Auto-rewrite has too many edge cases.                                     |
| Console capture    | None — consumers open DevTools                                           | Serialization complexity not worth it in v1.                              |
| User-file CSS      | Alphabetical concat, one `<style>` per file, hot-swap textContent        | `@import` opens a resolution rabbit hole.                                 |
| Tailwind           | Not bundled — consumers add via `headHtml`                               | Hard-bundling locks the styling story.                                    |
| Cold start         | None imposed by library — consumer's `files` prop is the source of truth | Defaults belong in `examples/demo`, not the library.                      |
