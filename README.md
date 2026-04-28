# mini-react-repl

A multi-file React + TSX REPL that runs entirely in the browser. Edit, see the
result live, ship the whole thing as static files

![preview](https://github.com/user-attachments/assets/923e87c3-9499-48ee-95b1-c946ad38f714)

```sh
npm i mini-react-repl monaco-editor react react-dom
```

```tsx
import { useState } from 'react';
import { Repl } from 'mini-react-repl';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import 'mini-react-repl/theme.css';

const HELLO = {
  'App.tsx': 'export default () => <h1>hi</h1>',
};

export default function Playground() {
  const [files, setFiles] = useState(HELLO);
  return (
    <Repl
      editor={MonacoReplEditor}
      files={files}
      onFilesChange={setFiles}
      vendor={import('mini-react-repl/vendor-default')}
    />
  );
}
```

That's the whole thing. Editor + live preview, multi-file, real React Fast
Refresh, no backend, no SSR, no server-side bundling.

---

## What you get

- multi-file TSX/TS/CSS, with imports across files
- bare specifier imports (`import { format } from 'date-fns'`) for a curated
  vendor set, swappable for your own
- React Fast Refresh — component state survives edits
- inline source maps so stack traces point at your `.tsx`, not transpiled JS
- Monaco gets pre-configured (automatic JSX, ES2022, bundler resolution) and
  pre-baked `.d.ts` for the curated vendor set — real squiggles + hover for
  `react`, `react-dom`, `date-fns`, `dayjs`, `lodash-es` out of the box
- strictly controlled state. you own the file table. persistence, sharing,
  undo, multi-tab sync — all yours to wire up however

## What it doesn't do, and won't pretend to

- **arbitrary npm at runtime.** the vendor set is fixed at build time. there's
  a builder if you want a different set. no esm.sh fallback in v1.
- **typescript diagnostics.** swc strips types and goes home. monaco's
  built-in JS service is what you get. if you want red squiggles for
  `date-fns` typos, that's a v2 problem (or yours).
- **folders.** flat file list. `./Counter`, not `./components/Counter`.
- **CJS.** ESM-only. modern browsers only — Chrome 109+, FF 108+, Safari 16.4+.
- **persistence, sharing, templates, console capture.** open DevTools for the
  console. write to IDB if you want to persist. the API gives you `files` and
  `onFilesChange`, the rest is on you. this is a feature.

If those are dealbreakers look at [Sandpack](https://sandpack.codesandbox.io/) (unmaintained)
or [StackBlitz WebContainers](https://webcontainers.io/) (monthly subscription) instead — they make different trade-offs and they're great at them

---

## How it actually works

The interesting part, and the part that took the longest to get right.

1. you change a file. `<ReplProvider/>` debounces 150ms.
2. the changed file is shipped to a Web Worker running `swc-wasm`. swc
   strips types, transforms JSX (automatic runtime), and injects React
   Refresh signatures.
3. main thread takes the JS back, runs an import-rewrite pass:
   - bare specifiers (`'react'`, `'date-fns'`) are left alone — the iframe
     has a native `<script type="importmap">` that resolves them
   - relative specifiers (`'./Counter'`) get rewritten to the current blob
     URL of that logical path
4. wrapped code becomes a `Blob`, becomes a `URL.createObjectURL`, gets
   `postMessage`d to the iframe.
5. the iframe imports the blob URL. on top-level execution, the module
   `commit()`s itself into a global registry keyed by **logical path**, not
   blob URL. React Refresh sees stable IDs, patches components in place,
   state survives.

The iframe itself is a srcdoc — generated once, never recomputed on file
edits. blobs come and go through postMessage. errors come back the same way.

That's the whole pipeline. ~30KB of glue around swc-wasm and react-refresh.

---

## API

```ts
import {
  Repl, // convenience: tabs + editor + preview
  ReplProvider, // headless: just the engine + context
  ReplFileTabs, // headless: tabs UI
  ReplPreview, // headless: the iframe + error overlay
  ReplErrorOverlay, // standalone overlay component
  useRepl, // hook: files + crud actions
} from 'mini-react-repl';
```

### `<Repl/>` props

| prop                      | type                                              | required | default      |                                                                     |
| ------------------------- | ------------------------------------------------- | -------- | ------------ | ------------------------------------------------------------------- |
| `files`                   | `Record<string, string>`                          | yes      | —            | flat path → source map                                              |
| `onFilesChange`           | `(next) => void`                                  | yes      | —            | called on every set/remove/rename                                   |
| `vendor`                  | `VendorBundle`                                    | yes      | —            | `{ importMap, baseUrl? }`                                           |
| `editor`                  | `React.FC<ReplEditorProps>`                       | yes      | —            | adapter component                                                   |
| `entry`                   | `string`                                          | no       | `'App.tsx'`  | the logical entry path                                              |
| `transformDebounceMs`     | `number`                                          | no       | `150`        |                                                                     |
| `headHtml`                | `string`                                          | no       | `''`         | injected into iframe `<head>`                                       |
| `bodyHtml`                | `string`                                          | no       | `''`         | injected into iframe `<body>`                                       |
| `showPreviewErrorOverlay` | `boolean`                                         | no       | `true`       | toggle built-in overlay                                             |
| `onPreviewError`          | `(err: ReplError) => void`                        | no       | —            | transform + runtime errors                                          |
| `onMounted`               | `() => void`                                      | no       | —            | fires when the iframe runtime mounts the entry module               |
| `iframeRef`               | `Ref<HTMLIFrameElement>`                          | no       | —            | forwarded to the underlying `<iframe>`; `postMessage` host data in  |
| `onAddFile`               | `() => MaybePromise<string \| null \| undefined>` | no       | —            | custom add-file dialog; return the new path, or nullish to cancel   |
| `onDeleteFile`            | `(path) => MaybePromise<boolean \| void>`         | no       | —            | confirm/cancel deletion; return `false` to cancel                   |
| `swcWasmUrl`              | `string`                                          | no       | jsdelivr CDN | self-host this for offline / CI                                     |
| `loader`                  | `ReplLoader`                                      | no       | —            | per-file pre-processor; see [Custom file types](#custom-file-types) |

### Custom file types

Every file flows through a loader. The default is `defaultLoader`, which
implements the historic dispatch: `.css` → `<style>` injection,
`.tsx` / `.ts` / `.jsx` / `.js` → swc-compiled module, anything else → ignored.

Pass `loader` to replace it. The function runs once per file (on first load and
on every change). It receives the file's `source` plus a `transform` function
that's the same swc-wasm pipeline `defaultLoader` uses — call it from inside
your loader if you need TS/JSX compilation. Return a `ReplLoaderResult` to
claim the file, or `null` / `undefined` to skip it. Most loaders delegate
unhandled extensions back to `defaultLoader`:

```tsx
import { defaultLoader, type ReplLoader } from 'mini-react-repl';

const loader: ReplLoader = async (input) => {
  if (input.path.endsWith('.sqlite')) {
    // emit plain JS — no swc needed
    return {
      kind: 'module',
      code: `export default ${JSON.stringify(parseSqlite(input.source))};`,
    };
  }
  if (input.path.endsWith('.md')) {
    // generate TSX, then run it through the same swc pass `.tsx` files use
    const tsxSource = mdxToTsx(input.source);
    return { kind: 'module', code: await input.transform(tsxSource, { tsx: true }) };
  }
  return defaultLoader(input);
};

<Repl
  files={files}
  onFilesChange={setFiles}
  vendor={defaultVendor}
  editor={MonacoReplEditor}
  loader={loader}
/>;
```

`ReplLoaderResult` is a discriminated union:

| variant                            | meaning                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `{ kind: 'css', source: string }`  | inject `source` as a `<style>` tag                                                                                  |
| `{ kind: 'module', code: string }` | `code` is already-compiled JS; the engine runs `rewriteImports` on it so relative specifiers resolve to other files |
| `null` / `undefined`               | skip the file                                                                                                       |

A user file can `import data from './data.sqlite'` once the loader claims it
— relative imports resolve against the `files` map by literal name first, so
non-standard extensions just work as long as you write them out.

The `loader` prop is boot-time only (like `vendor` / `entry`); to swap, remount
the provider with a different `key`.

### `useRepl()`

```ts
const { files, setFile, removeFile, renameFile } = useRepl();
```

That's it. No `errors`, no `forceRefresh`, no `getPreviewIframe`. By design.
errors come through `onPreviewError`. if you need an imperative reset, change
the `key` prop on `<ReplPreview/>`.

### Headless layout

```tsx
<ReplProvider files={files} onFilesChange={setFiles} vendor={defaultVendor}>
  <Sidebar>
    <ReplFileTabs />
  </Sidebar>
  <Main>
    <Top>
      <MyEditor />
    </Top>
    <Bottom>
      <ReplPreview
        headHtml={`<script src="https://cdn.tailwindcss.com"></script>`}
        onPreviewError={(e) => toast(e.message)}
      />
    </Bottom>
  </Main>
</ReplProvider>
```

`ReplProvider` is just context + the engine. lay it out however.

---

## Vendor

The vendor bundle is what lets `import { format } from 'date-fns'` work. it's
a curated, prebuilt set of ESM modules + an import map.

### Default

```tsx
import { defaultVendor } from 'mini-react-repl/vendor-default'

<Repl vendor={defaultVendor} ... />
```

includes: `react@19`, `react-dom@19`, `react/jsx-runtime`,
`react/jsx-dev-runtime`, `date-fns@3`, `dayjs@1`, `lodash-es@4`. inlined as
base64 data URLs so it works under srcdoc with zero hosting setup. ~400KB
gzipped JS, plus pre-baked `.d.ts` (`vendor.types`) so Monaco shows real
red squiggles + hover signatures for the same packages — also opt-in via
this subpath import.

if your demo needs literally only those libs, stop reading.

### Custom

You're going to outgrow the default. when that happens, write a `vendor.ts`
that declares the bundle shape via standard ESM imports/exports:

```ts
// vendor.ts
// Re-exports the iframe-runtime required core (react, react-dom,
// react-dom/client, react/jsx-runtime, react/jsx-dev-runtime,
// react-refresh/runtime). Skip this and the build errors loudly.
export * from 'mini-react-repl/vendor-base';

import * as zod from 'zod';
import * as framer from 'framer-motion';
import * as lodash from 'lodash-es'; // alias source: iframe imports 'lodash'

export { zod, framer as 'framer-motion', lodash };
```

then build it:

```sh
# repl-vendor-build needs esbuild; it's an optional peer dep, install once:
npm i -D esbuild

npx repl-vendor-build vendor.ts \
  --out public/vendor \
  --bundle-out src/vendor/repl.vendor.json
# → public/vendor/<chunks>.js     (one ESM chunk per package, served at /vendor/*)
# → public/vendor/repl.types.json (.d.ts payload, fetched at runtime)
# → src/vendor/repl.vendor.json   (just the import map — bundler-imported)
```

types live next to the JS chunks rather than inlined in the bundler-imported
JSON, so the bundler chunk stays tiny (a few KB) and the multi-MB `.d.ts`
payload is fetched in parallel. The bundle JSON embeds a `typesUrl` pointer,
so `<Repl/>` does the fetch itself — wiring is just:

```tsx
import vendor from './vendor/repl.vendor.json';
<Repl vendor={vendor} ... />
```

or code-split:

```tsx
<Repl vendor={import('./vendor/repl.vendor.json')} ... />
```

the builder is an esbuild wrapper. `format: 'inline'` emits base64 data URLs
(stay-within-srcdoc, no hosting). `format: 'hosted'` emits real files with
content hashes you can serve under `Cache-Control: immutable`

programmatic API too if you want to run it from a script:

```ts
import { build } from 'mini-react-repl/vendor-builder';
const vendor = await build({
  entry: 'vendor.ts',
  format: 'hosted',
  outDir: 'public/vendor',
  types: 'embed', // optional; default 'omit'
});
```

### Mix

```ts
import { defaultVendor } from 'mini-react-repl/vendor-default';

const vendor = {
  importMap: {
    imports: {
      ...defaultVendor.importMap.imports,
      zod: '/vendor/zod.js',
    },
  },
  baseUrl: '/vendor',
};
```

### Virtual modules

For ad-hoc helpers you don't want to ship as a vendor chunk — small
utilities, theming primitives, mock APIs — pass them inline:

```tsx
const VIRTUAL_MODULES = {
  '@app/util': `export const greet = (name: string) => 'hello ' + name`,
} as const;

<Repl files={files} virtualModules={VIRTUAL_MODULES} ... />
```

User code in the REPL can `import { greet } from '@app/util'` — the iframe
runtime executes it; Monaco autocompletes against the source. No bundling,
no hosting, no import-map entry. Virtuals can import each other and any
vendor package (`react`, `date-fns`, …) — the iframe's existing dep
substitution and the import map handle both.

**Boot-time only.** Snapshotted on first mount, identical to `vendor`.
Hoist to a top-level `as const` so the reference stays stable. Collisions
with `vendor.importMap.imports` keys resolve in favor of the virtual.
CSS aliases are not yet supported.

See `examples/virtual-modules/` for a working setup with cross-virtual imports.

---

## Editor

You bring your own. the library doesn't bundle one by default. there's an
adapter contract:

```ts
type ReplEditorProps = {
  path: string;
  value: string;
  onChange: (next: string) => void;
  language: 'typescript' | 'javascript' | 'css';
  types?: TypeBundle; // forwarded from vendor.types; ignore if you don't care
};
```

write a component matching this shape, pass it as `editor={...}`. that's the
whole interface.

### The Monaco one

Most people are going to want Monaco. shipped under a separate import path so
its weight is opt-in:

```tsx
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
```

`monaco-editor` is an _optional_ peer dep — only the people who import this
path install it. you'll still need a Monaco worker setup for your bundler
([vite-plugin-monaco-editor](https://github.com/vdesjs/vite-plugin-monaco-editor)
or [monaco-editor-webpack-plugin](https://github.com/microsoft/monaco-editor-webpack-plugin)),
which Monaco needs whether or not you're using this library.

#### type-checking config

`MonacoReplEditor` configures Monaco's TS service on mount with compiler
options matching the runtime transform: automatic JSX, ES2022, bundler
resolution, strict, etc. Without this Monaco's defaults reject every `.tsx`
file with TS17004 (`--jsx not provided`) and every bare specifier with
TS2792 (module not found). If you want to override:

```tsx
<MonacoReplEditor compilerOptions={{ strict: false }} />
```

Same for `diagnosticsOptions`. Both are passthroughs to
`monaco.languages.typescript.typescriptDefaults`.

If `vendor.types` is set (the default vendor pre-bakes it; the builder
emits `repl.types.json` next to the chunks for custom vendors),
`MonacoReplEditor` registers each `.d.ts` via `addExtraLib` so users get
real diagnostics + hover signatures for vendor packages. `vendor.types`
also accepts a `Promise<TypeBundle>` so a runtime `fetch('/vendor/repl.types.json')`
loads in parallel to the rest of the app.

### CodeMirror? plain textarea?

Sure. write the adapter:

```tsx
const TextAreaEditor: React.FC<ReplEditorProps> = ({ value, onChange }) => (
  <textarea value={value} onChange={(e) => onChange(e.target.value)} />
);
```

doesn't get more "bring your own" than that.

---

## Styling

unstyled by default. components emit stable class names + data attributes:

```html
<div class="repl-tabs">
  <button class="repl-tab" data-active="true">App.tsx</button>
</div>
<div class="repl-preview"><iframe class="repl-iframe"></iframe></div>
<div class="repl-error-overlay">…</div>
```

three options:

```ts
import 'mini-react-repl/theme.css'; // sane defaults, light + dark
```

…or write your own CSS targeting `.repl-*` and `[data-active]`.

…or wrap each component, every one accepts `className` and `style`.

no Tailwind dep, no CSS-in-JS, no global pollution beyond the class names.

---

## Iframe extras

The preview is a srcdoc. you can inject into it:

```tsx
<ReplPreview
  headHtml={`
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <script>window.MY_API_KEY = 'demo-key'</script>
  `}
  bodyHtml={`<div id="my-extra-portal"></div>`}
/>
```

`headHtml` runs **before** the import map and runtime, so don't try to use
the registry from there. `bodyHtml` is appended after `#root`, run anything
that should run after the React root mounts.

if you want Tailwind in your previews this is where it goes. the library
doesn't bundle it.

---

## Errors

```tsx
<Repl
  showPreviewErrorOverlay={true} // default
  onPreviewError={(err) => {
    if (err.kind === 'runtime') sentry.captureException(err);
    setLastError(err);
  }}
/>
```

```ts
type ReplError =
  | { kind: 'transform'; path: string; message: string; loc?: { line: number; column: number } }
  | { kind: 'runtime'; message: string; stack: string }
  | { kind: 'resolve'; path: string; specifier: string };
```

both transform and runtime errors flow through the same callback. line/col is
mapped to original `.tsx` via inline source maps.

when transform fails, **the previous render stays mounted**. you don't lose
your DOM because you forgot a `}`. this is intentional and the thing that
makes it feel like Vite dev rather than a "syntax error → blank page" REPL.

set `showPreviewErrorOverlay={false}` if you want to render the error
yourself.

---

## Caveats

things that will bite you. read this part.

- **bundler-native worker imports.** the library does
  `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`.
  works in Vite, Rollup 4+, Webpack 5+, esbuild bundle, Parcel 2. doesn't
  work in pure-CDN no-bundler setups. there's a `/standalone` entry planned
  for v2 with the inline-Blob-worker trick.
- **srcdoc origin.** stack traces show `about:srcdoc:42` for the iframe HTML
  itself. blob: URLs for transformed user code. inline source maps map back
  to original `.tsx`. DevTools "Sources" works. but if you grep frames for a
  pretty path you'll see srcdoc.
- **swc-wasm fetches at runtime.** by default from jsdelivr. self-host it for
  offline / CI / strict CSP:
  ```tsx
  <Repl swcWasmUrl="/swc.wasm" />
  ```
- **Monaco workers are not our problem.** if Monaco is your editor, you have
  to configure its workers in your bundler. there's no way around this and
  every Monaco-based library has the same constraint.
- **CSS files.** alphabetical concat across files. one `<style>` per file.
  `@import` doesn't resolve (browsers will try and fail).
- **rename/delete breaks importers.** no auto-fix. importing files will fail
  to transform, the overlay shows `Module not found`, last-good render stays.
  fix the import yourself. (consider this a feature: predictable, no magic.)
- **no sandbox attribute on the iframe.** user code shares origin with your
  app. if you're hosting third-party snippets, you want a separate origin —
  v1 doesn't ship that. trust model is: people editing their own code on
  their own machine.
- **strictly controlled state means re-renders are yours to manage.** if you
  do `onFilesChange={files => setHeavyState(files)}` and `setHeavyState` is
  expensive, that's on you. the library debounces _transformation_ (150ms)
  but not your `setState`.

---

## Compared to

|                    | this                                                    | Sandpack                          | StackBlitz WebContainers                            |
| ------------------ | ------------------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| how it transforms  | swc-wasm in a worker, browser only                      | bundler in a worker, browser only | full Node in WASM, real npm                         |
| arbitrary npm      | no, curated                                             | yes, via esm.sh                   | yes, real npm install                               |
| static deploy      | yes, no backend at all                                  | yes                               | no, needs CSP/COOP/COEP headers from special origin |
| backend, ssr, etc. | no                                                      | no                                | yes, runs Node                                      |
| bundle size        | small (engine ~30KB + swc 3MB wasm + your vendor)       | medium                            | enormous, but you get a whole VM                    |
| works offline      | yes (with self-hosted swc.wasm + inline default vendor) | partly                            | no                                                  |

if you need real npm, real Node, you want WebContainers. if you need
arbitrary client-side npm with a CDN runtime, Sandpack. if you want a fast,
boring, static-deployable React playground with a known set of libs, this.

---

## FAQ

**how do I add a library?**
write a `vendor.ts` (re-export `mini-react-repl/vendor-base` plus your own
deps), run `npx repl-vendor-build vendor.ts`, pass the result.
see [Vendor](#vendor).

**can I use this for tutorials / blog post embeds?**
yes — that's the main use case. srcdoc preview means it works inside an
iframe-in-an-iframe just fine. ship the demo as a static page, embed
anywhere.

**why not just use Vite?**
Vite needs a dev server. this doesn't. drop the build output on a static host
and you're done.

**why no Service Worker for module resolution?**
considered it. SW gives stable URLs (good for Refresh) but adds lifecycle
complexity, scope rules, registration timing. blob URLs + a logical-path
registry get the same Refresh behavior with no SW required. trade-off
favored simplicity.

**HMR for non-component edits?**
React Refresh handles it. utility/hook edits invalidate up to the nearest
component boundary, which gets re-rendered. cascade is usually 1–2 modules
deep. you don't have to think about it.

**can I get TypeScript red squiggles for the vendor libs?**
not in v1. swc strips types, that's the whole transform pipeline. for full
diagnostics you'd run `@typescript/vfs` + `tsserver` in another worker and
load `.d.ts` for every vendor package. it's a few MB and a non-trivial
amount of code. it's on the v2 list.

**does it work in Storybook / Docusaurus / Notion-like embeds?**
yes — srcdoc preview means it doesn't care what frame it's rendered in.

**why ESM-only? no CJS?**
it's 2026. our minimum browser is Safari 16.4. node 20 understands ESM. CJS
is a tax we don't want to pay.

---

## Dev

```sh
git clone https://github.com/jantimon/mini-react-repl
cd mini-react-repl
pnpm install
pnpm dev          # runs examples/demo
pnpm test         # vitest
pnpm test:e2e     # playwright (chromium only for now)
pnpm build        # tsup, library only
```

repo layout:

```
src/                  # the library
src/runtime/          # code shipped INTO the iframe srcdoc
src/engine/           # transform pipeline (worker, registry, rewriter)
src/components/       # React components
src/editor-monaco/    # optional Monaco adapter (separate export)
src/vendor-default/   # optional default vendor (separate export)
src/vendor-builder/   # optional vendor CLI (separate export)
examples/demo/        # vite app, used by playwright
examples/transform/   # custom-loader example (.md → React)
```

E2E tests run against `examples/demo` on chromium only for v1. firefox + webkit
are deferred until the chromium suite is stable. see [SPEC.md](./SPEC.md) §17.

PRs welcome. small ones land fast. for anything architectural, open an issue
first — there's a decision log in [SPEC.md](./SPEC.md) §20 covering the
tradeoffs already made, please skim before proposing reverts.

---

## License

MIT
