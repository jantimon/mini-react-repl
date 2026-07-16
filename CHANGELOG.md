# Changelog

## 0.24.0

### Minor Changes

- 6ee709e: Add an `hmr` prop to opt out of Fast Refresh

  Defaults to `true`, so nothing changes unless you ask. Pass `hmr={false}` for a
  read-only preview whose files never change after boot: swc emits no Refresh
  signatures, the preamble script is dropped, and modules are wrapped without the
  Refresh prologue — so what's left in each compiled module is your code, with no
  Refresh work on every commit.

  Editing still works with `hmr={false}`, but every change re-boots the preview
  and component state is lost. Element inspection is unaffected.

### Patch Changes

- 6ee709e: Fix `showPreviewErrorOverlay={false}` having no effect

  `generatePreviewHtml` writes `data-overlay="off"` on the preview document, but
  the runtime read it off `window.frameElement` — the host's iframe element, which
  nothing sets it on, and which is null across the preview's opaque sandbox origin
  anyway. The overlay always showed. Read it from the document instead.

All notable changes to `mini-react-repl`. Dates are YYYY-MM-DD.

## 0.23.1 — 2026-07-06

### Fixed

- **Rspack/webpack/Vite no longer choke on the dead swc wasm URL.**
  `dist/worker.js` inlined `@swc/wasm-web`'s init glue, whose default
  `new URL('wasm_bg.wasm', import.meta.url)` fallback pointed at a file this
  package doesn't ship. The branch never ran (the worker always passes an
  explicit wasm URL), but bundlers resolve `new URL(..., import.meta.url)`
  statically and failed the consumer's build on the missing asset. The
  fallback is now stripped at build time. If you patched `dist/worker.js` or
  disabled `new URL` parsing to work around this, you can drop the workaround.
- **Server bundles no longer pull in the transform worker.** The
  `new Worker(new URL('./worker.js', import.meta.url))` expression moved out
  of `dist/index.js` into a `#create-worker` module with a conditional
  `imports` entry: bundlers targeting Node (Next.js app router server bundles,
  Vite `ssr.noExternal`) resolve a small throwing stub instead of compiling
  the worker + swc wasm glue for the server. Browser bundles are unchanged.

### Changed

- **BREAKING: `date-fns` and `lodash-es` dropped from the default vendor.**
  The default set is now `react`, `react-dom`, the JSX runtimes, and `dayjs`
  only. The two libraries were by far the heaviest entries in the inlined
  default bundle — together ~507 kB of the import-map JS and ~876 kB of the
  pre-baked `.d.ts` (the bulk of that being the full `@types/lodash` tree,
  578 of the 592 `.d.ts` files). Removing them cuts the default
  `vendor-default/import-map.json` from ~1.63 MB → ~1.12 MB raw (≈289 kB →
  ≈202 kB gzipped) and `types.json` from ~1.95 MB → ~1.08 MB.

  In 2026, modern browsers cover most of what these libraries did (native
  `Object.groupBy`, `structuredClone`, `Intl` date formatting, array helpers),
  and the opt-in `cdn` prop lazy-loads either of them — or anything else — from
  esm.sh on demand. `dayjs` stays in the default set because it covers the
  common date-formatting case at ~4 kB gzipped.

### Migration

- If your REPL content imports `date-fns` or `lodash-es` and relies on the
  default vendor, either add the `cdn` prop
  (`import { createEsmShCdnHandler } from 'mini-react-repl/cdn-esmsh'`) or ship
  a custom vendor bundle that re-adds them — see the "Mix" section of the
  README.

## 0.22.0 — 2026-06-01

### Added

- **New `baseHref` prop sets the preview's `<base href>`.** The preview
  document loads from a sandboxed `blob:` URL, so root-relative URLs in user
  code (e.g. `<img src="/img/yak-jumping.png">`) resolved against the opaque
  `blob:` origin — which has no server behind it — and failed. A `<base>` is
  now emitted as the first element in `<head>` (ahead of `headHtml` and the
  import map, so it governs their URLs too), defaulting to the embedder's
  `window.location.origin`. Pass a custom origin to point assets elsewhere, or
  `baseHref={null}` to omit the tag. Available on `<Repl>`, `<ReplPreview>`,
  and `generatePreviewHtml`. Server-rendered output omits it (no `window`),
  matching the client-only preview.

## 0.21.0 — 2026-05-29

### Added

- **The in-preview error overlay now announces via `role="alert"`.** When a
  transform, module-resolution, or runtime error surfaces, the overlay is
  exposed to assistive tech as a live region the moment it appears, matching
  the standalone `<ReplErrorOverlay/>`. No API change — purely an a11y
  improvement that ships in the bundled runtime.

## 0.20.0 — 2026-05-29

### Added

- **Opt-in `cdn` prop: lazy-load any npm package from esm.sh on demand.**
  Bare specifiers the prebuilt `vendor` import map doesn't cover are resolved
  through a pluggable `ReplCdnResolver` and rewritten to an absolute URL at
  transform time — no import-map mutation, no iframe reload. It layers
  _behind_ the vendor map: vendor specifiers always win, so the React
  singleton, offline support, and Monaco types stay intact for the curated
  set; esm.sh handles the long tail. Off unless you pass it, so the
  "static-deploy, no surprise network calls" default is unchanged.

  ```tsx
  import { createEsmShCdnHandler } from 'mini-react-repl/cdn-esmsh';

  // Stable reference — created once at module scope.
  const cdn = createEsmShCdnHandler({ versions: { 'canvas-confetti': '1.9.3' } });

  <Repl files={files} vendor={defaultVendor} cdn={cdn} … />;
  ```

- **New `mini-react-repl/cdn-esmsh` subpath** exporting `createEsmShCdnHandler`
  and `EsmShOptions` (`origin`, `versions`, `allow`, `query`). Every emitted
  URL carries `?external=<vendor keys>` so a lazy package reuses the vendor's
  React (and other singletons) instead of bundling its own — the fix for
  "Invalid hook call" across the vendor/esm.sh boundary.

- **New `ReplCdnResolver` type** exported from the package root, plus the
  `examples/cdn-esmsh/` demo (a hermetic, network-free e2e that also proves
  the React singleton holds across the boundary).

- **`package.json` version pinning from inside the REPL.** When the file table
  contains a `package.json`, `createEsmShCdnHandler` reads its `dependencies`
  and pins lazy esm.sh imports to those ranges — so users can pin from the
  editor, a source the boot-time-frozen resolver config can't track. The
  explicit `versions` option stays authoritative and wins on conflict;
  malformed JSON and protocol ranges (`workspace:`, `file:`) are ignored.
  `ReplCdnResolver` gains an optional `declaredVersions` argument for custom
  resolvers.

### Notes

- CSP: when `cdn` is enabled and you set a CSP, allow esm.sh under
  `script-src` — ES module fetches, static and dynamic, are governed by that
  directive. Lazy esm.sh modules have no `.d.ts`, so they show as Monaco
  squiggles even though they run.

## 0.19.0 — 2026-05-28

### Changed (breaking)

- **`TypeBundle.libs` is now `Record<string, string>` (path → content)
  instead of `Array<{ path: string; content: string }>`.** The old shape
  allowed duplicate paths at the type level even though `repl-vendor-build`
  always emitted unique paths (deduped via the internal `seen: Set`) and
  the Monaco adapter ref-counted by path. The new shape encodes that
  invariant in the type system, shaves ~22 bytes of structural overhead
  per entry from the wire format (small but real on a ~2 MB types
  payload), and replaces `Array.prototype.find`-style lookups with O(1)
  property access. Migration:

  ```ts
  // before
  const types: TypeBundle = {
    libs: [
      { path: "file:///node_modules/foo/index.d.ts", content: "..." },
      { path: "file:///loader-ambient.d.ts", content: "..." },
    ],
  };
  // after
  const types: TypeBundle = {
    libs: {
      "file:///node_modules/foo/index.d.ts": "...",
      "file:///loader-ambient.d.ts": "...",
    },
  };
  ```

  Bundles built with `repl-vendor-build` regenerate to the new shape on
  next run; consumers that wrap or extend `vendor.types` (e.g. the
  `examples/transform` pattern that merges in an ambient `.d.ts` for a
  loader) need to spread the object literal instead of the array.

## 0.18.0 — 2026-05-27

### Changed

- **Preview iframe is now loaded via a `blob:` URL instead of `srcdoc`.**
  The HTML is identical; only the delivery mechanism changes. DevTools
  shows `src="blob:https://…/uuid"` instead of inlining the full preview
  document on the iframe element, which makes the Elements panel
  readable and the URL navigable. Anyone who was reading
  `iframe.srcdoc` from tests or tooling should switch to fetching the
  blob URL or reading `iframe.contentDocument` (only available under
  `unsafeDropSandbox`). Sandbox / origin behaviour is unchanged in both
  the default and `unsafeDropSandbox` modes.
- **`iframeRef` and `onMounted` fire on every preview soft reload,**
  not just on first mount. When the consumer changes `headHtml` /
  `bodyHtml` / `showPreviewErrorOverlay`, the iframe's `contentWindow`
  is replaced — but previously no callback fired, so any host state
  `postMessage`-ed into the iframe was silently dropped. The ref now
  cycles `null → element` so consumers can re-send. The DOM element
  identity is preserved across the cycle; only `contentWindow` turns
  over. Boot config (`vendor`, `swcWasmUrl`, `loader`,
  `virtualModules`) is unaffected.

## 0.17.0 — 2026-05-27

### Changed (breaking)

- **`VendorBundle` types collapsed into `Resolvable<T>`.** The 3-way union
  for `importMap` / `types` (sync / Promise / thunk, each optionally
  wrapped in `{ default: T }`) is now one recursive `Resolvable<T>` helper,
  exported from the package root. No runtime change — every `vendor` value
  that worked before still works.
- **`<ReplProvider activePath>` is a discriminated union.** Controlled
  mode (`activePath` provided) now requires `onActivePathChange`;
  uncontrolled mode optionally takes `defaultActivePath` plus an advisory
  `onActivePathChange`. Mixing them is a compile error instead of silently
  letting `defaultActivePath` win.
- **`<ReplPreview sandbox={null}>` → `unsafeDropSandbox`.**
  ```diff
  - <ReplPreview sandbox={null} />
  + <ReplPreview unsafeDropSandbox />
  ```
  The default sandbox tokens are exported as `DEFAULT_SANDBOX` from the
  package root so consumers can extend rather than re-type.
- **`MonacoReplEditor theme="auto"`** is the explicit sentinel for "track
  the `color-scheme` cascade" (previously `theme={undefined}`). `'auto'`
  is the default; pass any registered theme name to pin.
- **`defaultLoader` moved to `mini-react-repl/loader`** so REPL-only
  consumers don't pull it into their root chunk.
  ```diff
  - import { defaultLoader } from 'mini-react-repl';
  + import { defaultLoader } from 'mini-react-repl/loader';
  ```
- **`useRepl()` no longer carries `lastError`.** Read it via the new
  `useReplError()` hook. File-editing UIs no longer re-render when an
  error appears or clears.
- **`mini-react-repl/vendor-builder` subpath removed.** The programmatic
  `build()` Node API is no longer published. The `repl-vendor-build` CLI
  is the only supported entry point — wire it into your build via an npm
  script or pre-build hook.
- **`loadVendorImportMap` / `loadVendorTypes` removed.**
  `mini-react-repl/vendor-default` exports only `defaultVendor` now.
  Prefetch via the lazy thunks directly:
  ```diff
  - button.addEventListener('pointerover', () => void loadVendorImportMap())
  + button.addEventListener('pointerover', () => void defaultVendor.importMap())
  ```

### Added

- **Circular-import detection.** Cold-boot topo-sort surfaces cycles as
  transform errors (`Circular import: A → B → C → A`).
- **`useReplError()` hook**, plus `DEFAULT_SANDBOX` and `Resolvable<T>`
  re-exports from the package root.
- **`<ReplFileTabs entry>` prop** to override the protected entry path
  independently of `<ReplProvider entry>`.
- **`repl-vendor-build --export-name <name>` flag** to rename the
  generated `VendorBundle` constant (CLI default stays `customVendor`).
- **Dev-time warning** when a `virtualModules` key shadows a
  `vendor.importMap.imports` key.

### Fixed

- **Tab close button is keyboard-accessible.** It's now a real `<button>`
  sibling of the `<button role="tab">`, both wrapped in a
  `role="presentation"` span. Each tab and close button is reachable via
  Tab in document order; Enter / Space activate. (No arrow-key navigation
  between tabs yet.)
- **`prewarm()` errors no longer disappear.** Worker-init failures during
  prewarm route through `onWorkerError` (or reject the returned promise
  when none is set).

### Migration

1. **Sandbox**: `sandbox={null}` → `unsafeDropSandbox`.
2. **Loader**: import `defaultLoader` from `mini-react-repl/loader`.
3. **Controlled active path**: if you pass `activePath`, also pass
   `onActivePathChange`. If you used `defaultActivePath`, drop
   `activePath`.
4. **Errors**: if you read `lastError` from `useRepl()`, switch to
   `useReplError()`.
5. **Programmatic vendor build**: drop
   `import { build } from 'mini-react-repl/vendor-builder'` and invoke
   the CLI instead (`"build:vendor": "repl-vendor-build src/vendor.entry.ts"`).
   The output folder is identical.
6. **Vendor prefetch helpers**: replace `loadVendorImportMap()` /
   `loadVendorTypes()` with `defaultVendor.importMap()` /
   `defaultVendor.types()`.

## 0.16.0 - 2026-05-27

### Changed (breaking)

- **swc-wasm prewarms on `<ReplPreview/>` mount.** The worker JS chunk and `wasm_bg.wasm` now start downloading as soon as the preview component mounts, in parallel with vendor / import-map resolution and the iframe boot. Previously the worker was constructed inside the iframe's ref callback, so wasm queued behind the entire iframe-runtime + vendor `data:` URL boot, landing last in the waterfall. Universal across vendor input shapes — including Promise-typed `vendor={import('./vendor')}` consumers, where wasm previously waited for the vendor promise + import-map to both resolve.
- **`TransformClient` API**: output callbacks moved off the constructor onto a new `attachSession(handlers)` method, which returns a `{ detach }` handle. `TransformClientOptions` keeps only boot config (`swcWasmUrl`, `loader`, `virtualModules`, `debounceMs`). A new `prewarm(): Promise<void>` triggers worker + wasm download without an attached session. Direct callers of `new TransformClient(...)` must migrate to the two-step (`new TransformClient(opts)` → `attachSession({...})`).
- **`ResolvedVendorBundle` removed from the public surface.** It carried a `types` field that was no longer read by anyone after the 0.16.0 import-map lazy-load. `generatePreviewHtml({ vendor: { importMap, ... } })` becomes `generatePreviewHtml({ importMap, ... })` — pass the import map directly. `<Repl/>` / `<ReplProvider/>` props are unchanged.
- `--out` now takes a directory. When omitted, the CLI derives `<entry-dir>/<entry-stem>.generated/` from the entry path (any JS/TS extension is accepted; the `.entry.` infix is stripped if present, so `vendor.entry.ts` and `vendor.ts` both produce `vendor.generated/`). The `.generated` suffix is matched by most default ignore globs (Prettier, oxlint, Knip) so existing CI does not need to allow-list it. Pass `--out <dir>` to override.
- The single-file output from 0.15.0 is gone. There is no flag to restore it. The folder is the only output shape.
- `VendorBundle.importMap` is now a union: it accepts a sync `ImportMap`, a `Promise<ImportMap | { default: ImportMap }>`, **or** a thunk returning either. The generator emits the thunk form (with an SSR window-guard) so the host bundle never inlines vendor data. `<ReplProvider/>` resolves the thunk on `<Repl/>` mount; the iframe boots once it lands. Direct callers of `mini-react-repl/preview-html`'s `generatePreviewHtml({ vendor })` must still pass a resolved bundle (sync `importMap`) — the new exported `ResolvedVendorBundle` names this shape.
- `mini-react-repl/vendor-default`'s `defaultVendor.importMap` is now wired through `loadVendorImportMap()`, mirroring the existing `loadVendorTypes()`. The default-vendor dist split is now `data-import-map-*.js` + `data-types-*.js`; consumers using `defaultVendor` directly see no API change beyond the now-lazy semantics. `loadVendorImportMap()` is a new named export for prefetching (hover, idle).
- Generated chunks use `webpackChunkName` hints `mini-react-repl-import-map` and `mini-react-repl-types` so the chunk filenames in bundler output and Network panels make their origin obvious. Vite/Rolldown still hash the actual filenames; the magic comment seeds the base name where supported.

### Migration

1. Drop `--out`: `repl-vendor-build src/vendor/vendor.ts` (output goes to the sibling `vendor.generated/` folder).
2. Replace the JSON import with the named export:
   ```diff
   - import vendor from './vendor/repl.vendor.json';
   + import { customVendor as vendor } from './vendor/vendor.generated';
   ```
3. `.gitignore` the new folder and delete the old `repl.vendor.json`.
4. Direct callers of `generatePreviewHtml`:
   ```diff
   - generatePreviewHtml({ vendor: { importMap } });
   + generatePreviewHtml({ importMap });
   ```
5. Direct callers of `new TransformClient({...})`:
   ```diff
   - const client = new TransformClient({ swcWasmUrl, onModule, onCssUpsert, onCssRemove, onError });
   + const client = new TransformClient({ swcWasmUrl });
   + const { detach } = client.attachSession({ onModule, onCssUpsert, onCssRemove, onError });
   ```

### Why

The 0.15.0 inline-only refactor lumped types into the same JSON as the import map, so any consumer doing `import("./vendor.generated.json")` parsed the entire ~5 MB type payload up-front even when the editor never mounted. The library still supported lazy types end-to-end (`VendorBundle.types` accepts a function, and `<EditorHost/>` invokes it on mount), but the builder offered no way to expose them as a separately-loadable artifact short of stripping them entirely with `--no-types`. The folder output restores the laziness as the default.

The import map itself was also a problem. Even after stripping types, a typical custom vendor's import map is 1–2 MB of base64 data URLs, and `import importMap from './vendor.generated.json'` baked the whole thing into the host bundle as a JS object literal — paid by every route in the app, including pages that never mount `<Repl/>`. Making `VendorBundle.importMap` a lazy thunk (resolved by the library on `<Repl/>` mount) lets bundlers code-split the import map into its own chunk: non-sandbox routes pay nothing for vendor data, sandbox routes parse a much smaller host bundle, and SSR doesn't pull the chunk into the server bundle. The iframe still can't boot before the import map lands (the browser requires `<script type="importmap">` to be in the srcdoc before any module script that uses a bare specifier runs), but the import-map fetch now races the rest of the React render work — and the types fetch runs in parallel with both the import-map fetch and the in-iframe swc-wasm fetch when an editor is mounted.

## 0.15.0 — 2026-05-26

### Security

- The preview iframe now ships with `sandbox="allow-scripts allow-forms"` by default. Previously the `srcdoc` iframe inherited the embedder's origin and could read parent cookies, mutate `window.parent.document`, and call host APIs with the user's session — none of that holds any more. User code runs cross-origin to the embedder with an opaque origin. `allow-forms` is included so React `<form onSubmit>` handlers fire (Chromium suppresses the submit event entirely without it); `allow-same-origin`, `allow-top-navigation`, and `allow-popups` are deliberately excluded.
- The runtime postMessage listener (`runtime.ts`) and the inspect picker's listeners now reject any event whose `event.source` isn't `window.parent`. Without this, any frame on the page could spoof `__repl: true` envelopes into the iframe runtime.
- New e2e suite at `tests/e2e/sandbox.spec.ts` asserts the default attributes are on the iframe and that user code attempting `window.parent.document.body.style.background = '…'` raises a runtime error without mutating the parent page.

### Added

- `<ReplPreview/>` accepts three new iframe-attribute props, all overridable per-mount:
  - `sandbox?: string | null` — defaults to `'allow-scripts allow-forms'`. Pass `null` to drop the attribute entirely (escape hatch for consumers that need same-origin DOM access; doing so makes user code able to act as the embedder).
  - `allow?: string` — Permissions-Policy delegated to the iframe via the `allow` attribute. Defaults to `''` (deny all delegated features).
  - `referrerPolicy?: React.HTMLAttributeReferrerPolicy` — defaults to `'no-referrer'` so user code can't leak the embedder URL via outbound requests.
- `<Repl>` forwards all three to its inner `<ReplPreview/>`.

### Changed

- `mini-react-repl/inspect` no longer injects the picker by mutating `iframe.contentDocument`. Cross-origin sandboxed iframes return `null` from `contentDocument`, so the old DOM-injection path was incompatible with the new sandbox default. The host now ships the picker source via a new `inspect:install` postMessage envelope; the runtime builds a `blob:` URL and `import()`s it on first activation. The lazy semantics are preserved — consumers who never mount `<InspectMode/>` never pay the picker cost. `ensurePickerInstalled(iframe)` now returns `Promise<boolean>` instead of `boolean`.
- The picker bundle (`scripts/build-picker.mjs`) ships as ESM instead of an IIFE so it can be dynamic-imported via a blob URL inside the iframe runtime.
- The vendor pipeline is **inline-only**. `repl-vendor-build` always emits `data:text/javascript;base64,…` URLs into a single bundle JSON; the hosted format and the static-hosting workflow it implied are gone. This eliminates the cross-origin CORS configuration the sandbox-by-default would otherwise require for hosted vendor files. The default vendor was already inline; behaviour there is unchanged. Custom-vendor consumers see a smaller surface area and one path to think about.
- `<ReplPreview/>`'s pending-vendor placeholder is now rendered with `class="repl-iframe-placeholder"` instead of `class="repl-iframe repl-iframe--placeholder"`. Sharing the `repl-iframe` class with the real iframe broke Playwright's `page.frameLocator('.repl-iframe')` during the vendor-pending window — the locator latched onto the placeholder div, couldn't resolve a contentFrame, and failed permanently instead of polling.

### Removed

- `VendorBundle.baseUrl` and `VendorBundle.typesUrl` (both were hosted-format only). `<ReplProvider/>`'s internal `applyTypesUrl` fetcher is gone with them.
- `repl-vendor-build` no longer accepts `--base-url` or the directory output mode (`--out <dir>` + `--bundle-out <file>`). The new shape is `repl-vendor-build <entry> --out <bundle.json> [--prod] [--no-types]` — a single JSON file with the import map and the types payload embedded.
- `mini-react-repl/preview-html`'s `resolveImportMap` helper (no longer needed; every import-map entry is already a fully-qualified `data:` URL).

### Migration

- **No changes required** if you use `mini-react-repl/vendor-default`: it was already inline; the default sandbox is the only behavioural change and existing user code that doesn't reach into `window.parent` continues to work.
- **If you used `repl-vendor-build` with hosted output**: update your build script.
  ```diff
  - repl-vendor-build vendor.ts --out public/vendor --bundle-out src/vendor/repl.vendor.json
  + repl-vendor-build vendor.ts --out src/vendor/repl.vendor.json
  ```
  Then delete `public/vendor/` — it's no longer used. The CORS configuration on your dev / prod server for `/vendor/*` is no longer needed either (and would have been required if you'd upgraded to the new sandbox while staying on hosted).
- **If you read `iframe.contentDocument` from outside the iframe** (custom test harnesses, external inspection): pass `<ReplPreview sandbox={null} />` to opt out of the sandbox. This makes user code same-origin with the embedder again; only do it in trusted contexts.
- **If you locator on `.repl-iframe--placeholder`**: the placeholder class was renamed to `repl-iframe-placeholder` (the `repl-iframe` class is now exclusive to the real `<iframe>`).

## 0.14.1 — 2026-05-22

### Fixed

- `import './foo.css'` from a JS/TSX file no longer crashes the iframe with `Failed to resolve module specifier "./foo.css". Invalid relative url or base scheme isn't hierarchical.` The import-rewriter now substitutes the specifier with an empty `data:text/javascript,` module when the resolved target is a `.css` file — relative specifiers can't resolve against the module's `blob:` URL (blob URLs are non-hierarchical), so a real specifier would never load. CSS is still injected as a `<style>` tag by the engine; the JS-level import is side-effect-only and now becomes a cheap no-op import. Dynamic `await import('./theme.css')` resolves to an empty module instead of throwing.

## 0.14.0 — 2026-05-20

### Changed

- `mini-react-repl/vendor-default` no longer ships the `.d.ts` payload as part of the statically-imported module. `defaultVendor.types` is now a function (`loadVendorTypes`) that dynamic-imports the payload from a separate code-split chunk; the library invokes it from `<EditorHost/>` only when an editor adapter actually mounts. REPL-only consumers (e.g. `<ReplPreview/>` without an editor) — and consumers wiring a custom editor that ignores types — no longer pay the ~100 kB gzipped types cost in their bundle. `<Repl vendor={defaultVendor}/>` works unchanged.
- `vendor.typesUrl` (custom-vendor builds emitted by `repl-vendor-build --bundle-out`) is now fetched lazily on the same trigger: `ReplProvider` installs a function under `vendor.types` instead of starting the fetch the moment the vendor resolves. Consumers that show only `<ReplPreview/>` no longer trigger the `repl.types.json` request at all.
- `VendorBundle.types` (`src/types.ts`) widens to also accept `() => TypeBundle | PromiseLike<TypeBundle | { default: TypeBundle }>`. The existing `TypeBundle` / `PromiseLike<TypeBundle>` forms keep working unchanged.

### Added

- `loadVendorTypes` named export on `mini-react-repl/vendor-default` — call it directly to warm the types chunk on hover, idle time, or any other consumer-chosen trigger.

## 0.13.1 — 2026-05-20

### Fixed

- `mini-react-repl/editor-monaco` SSR stub (`node` export condition) no longer trips React hydration when consumers omit `theme`. The real client adapter renders a Fragment of `<div>` + `<ColorSchemeWatcher>` when `theme === undefined`, but the SSR stub only emitted the `<div>` — a Fragment child-count mismatch that React flagged at hydration. The stub now mirrors the client's Fragment shape exactly (watcher's render is pure JSX; all DOM work lives in its ref callback, which doesn't fire on the server).

## 0.13.0 — 2026-05-16

### Changed

- `<ReplProvider/>` no longer returns `null` while a promise-typed `vendor` prop is pending. Children render immediately; `useRepl()` / `<ReplFileTabs/>` / `<EditorHost/>` are usable right away. `<ReplPreview/>` shows a sized placeholder (`<div class="repl-iframe repl-iframe--placeholder" aria-busy="true">`) until the vendor lands, then mounts the iframe normally. `actions.vendor` is `null` in context during this window — boot-time semantics are preserved by latching on first resolution (subsequent prop swaps still warn in dev).
- `<ReplProvider/>` now logs `console.error` if the vendor promise rejects, instead of leaving the preview placeholder indefinitely with no diagnostic.

## 0.12.2 — 2026-05-13

### Fixed

- `vendor-builder` no longer logs `[vendor-builder] no .d.ts found for ', ', skipping` when a transitively walked `.d.ts` declares a tuple containing the string `"from"` (e.g. recharts's `SVGElementPropKeys: readonly ["format", "from", "fx", …]`). The previous extractor used a regex over comment-stripped source, which still matched `from` inside string literals; the import walker now uses `es-module-lexer`, so string- and comment-aware tokenization makes the false positive structurally impossible.

## 0.12.1 — 2026-05-12

### Fixed

- `vendor-builder` no longer logs spurious `[vendor-builder] no .d.ts found for '..', skipping` warnings when a transitively walked `.d.ts` imports from `..` (or `.`). The relative-import check only matched `./` / `../` prefixes, so bare `.` / `..` directory specifiers fell through to package resolution and printed a false miss.
- Directory-form relative imports inside `.d.ts` files now also probe `index.d.mts` and `index.d.cts` (previously only `index.d.ts`), so ESM-only typings packages link up.

## 0.12.0 — 2026-05-10

### Changed

- Inspect overlay polish:
  - Soft blue-tinted shadow instead of a 2px border, with a 100ms show delay so the cursor passing through the iframe never flashes the overlay up, and a 120ms fade on both show and hide.
  - Glides between elements: `left`/`top`/`width`/`height` now animate (140ms ease) when the user hovers from one element to the next. The element stays mounted between hovers; the position snaps (transitions suppressed for one reflow) when re-appearing after a fade-out so it doesn't drift in from the previous target.
  - Forces `cursor: default` across the iframe document while inspect mode is active. User CSS cursors (`pointer` on links, `text` on inputs, etc.) imply actions that won't fire while picking — the single arrow matches DevTools' inspect mode.

## 0.11.0 — 2026-05-10

### Added

- **Inspect mode.** Click-to-source picker for the iframe preview: hover highlights React fibers, click resolves the JSX call site through the bundle's source map back to a user file/line/column/component. Imported separately so consumers who don't need it skip the picker chunk:
  ```tsx
  import { InspectMode } from 'mini-react-repl/inspect';
  <Repl ...><InspectMode active={picking} onElementPicked={...} onCancel={...} /></Repl>
  ```
  Picker is lazy-injected into the iframe on first activation. New e2e + unit tests cover fiber walk, stack parsing, and source-map mapping.
- `examples/gh-pages` and `examples/starter` extracted from the old `examples/demo`. `examples/e2e-fixture` is the Playwright target. The Pages showcase lazy-loads `mini-react-repl/inspect` via `React.lazy`.

### Fixed

- Inspect overlay is now actually visible on first render (the className-equality short-circuit was returning the div before the default style was applied) and renders into the top layer via `popover="manual"` so it paints above modal `<dialog>`, popovers, and `:fullscreen` content. Falls back to z-index where the popover API isn't available.

## 0.10.0 — 2026-05-10

### Changed

- Fast Refresh prologue collapsed to a single line, so frame offsets in stack traces shift by 1 instead of 5. Pairs with the source-map shift from 0.9.0.

## 0.9.0 — 2026-05-09

### Fixed

- Inline source maps now account for the Fast Refresh prologue. DevTools stack frames previously pointed 5 lines off; the body's `mappings` is shifted via a pure semicolon prepend (no VLQ decode needed). `sourcesContent` survives the base64 round-trip cleanly with non-ASCII characters.

## 0.8.1 — 2026-05-09

### Added

- `//# sourceURL=<path>` pragma on every wrapped module. DevTools and stack traces now attribute frames to the original path instead of the `blob:` URL. Path is percent-encoded against whitespace, quotes, and JS line terminators.

## 0.8.0 — 2026-04-29

### Added

- Default fallback for blank entry files. If `files[entry]` is missing or whitespace-only the engine injects an `App() => null` stub at runtime so HMR stays alive while you type from scratch. Consumer's `files` map is untouched — no `onFilesChange` bleed.

## 0.7.0 — 2026-04-29

### Added

- **`shell` prop on `<Repl>` / `<ReplProvider>`.** TSX source for the synthetic root the iframe mounts. Use it to wrap user code in a `<Suspense>`, error boundary, or theme provider without forcing the consumer to author the wrapper. Drop a real `ReplShell.tsx` into `files` to take over and edit it live. Boot-time only.

## 0.6.0 — 2026-04-28

### Added

- `useRepl().reloadPreview()` — recovery hatch when user code crashes the runtime past what Fast Refresh can rescue (empty entry, top-level throw). Forces an iframe unmount/remount via `key` bump and clears `lastError`.

## 0.5.0 — 2026-04-28

### Added

- **Dark mode plumbing.** New `<ColorSchemeWatcher>` component + `colorScheme` propagated through context. CSS-driven via `@property` + `transitionstart` so editor adapters observe the cascade rather than running a parallel `matchMedia`.
- **`languages` prop** — map file extension to editor language id (or pass a function). Pairs with custom loaders so Monaco can highlight `.md`, `.json`, etc. New `LanguageMap` type exported.
- `EditorHost` now resolves language via the prop with a fallback to the built-in dispatch (`.css` → `'css'`, `.js`/`.jsx`/`.mjs` → `'javascript'`, else `'typescript'`).

## 0.3.0 — 2026-04-28

### Added

- **`virtualModules` prop.** Inline modules exposed under bare specifiers without bundling or hosting:
  ```tsx
  <Repl virtualModules={{ '@app/util': `export const x = 1` }} ... />
  ```
  Virtuals can import other virtuals and any vendor package. Boot-time snapshot — hoist to a top-level `as const`. Collisions with `vendor.importMap.imports` resolve in favor of the virtual. CSS aliases not yet supported.

(no 0.4.0 — version skipped during development.)

## 0.2.0 — 2026-04-28

### Changed

- **Custom vendor builds now use a TS entry file.** Write a `vendor.ts` that re-exports `mini-react-repl/vendor-base` plus your packages, then:
  ```sh
  npx repl-vendor-build vendor.ts --out public/vendor --bundle-out src/vendor/repl.vendor.json
  ```
  Replaces the `--packages a,b,c` CLI flag. Types live next to the JS chunks (fetched in parallel) instead of inlined in the bundler-imported JSON, so the bundler chunk stays a few KB. The bundle JSON embeds a `typesUrl` pointer; `<Repl/>` does the fetch.
- README now uses `vendor={import('mini-react-repl/vendor-default')}` (lazy) instead of importing `defaultVendor` eagerly.

### Added

- `mini-react-repl/vendor-base` subpath export — the iframe-runtime required core (`react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-refresh/runtime`).
- `examples/custom-vendor` showing the new flow end-to-end.

## 0.1.2 — 2026-04-27

### Changed

- `repl-vendor-build` reworked: per-package ESM chunks, `.d.ts` collection, hosted-format output. `scripts/build-default-vendor.mjs` slimmed down to delegate to the shared builder.

## 0.1.1 — 2026-04-27

### Added

- `iframeRef` prop on `<Repl>` / `<ReplPreview>` — forwarded to the underlying `<iframe>` so you can `postMessage` host data in.
- `onMounted` callback — fires when the iframe runtime mounts the entry module.

### Notes

- `repl-vendor-build` needs `esbuild` as an optional peer dep — install once: `npm i -D esbuild`.

## 0.1.0 — 2026-04-27

Initial release.

- `<Repl>`, `<ReplProvider>`, `<ReplPreview>`, `<ReplFileTabs>`, `<ReplErrorOverlay>`, `<EditorHost>` components.
- `useRepl()` hook (`files`, `setFile`, `activePath`, `setActivePath`, `lastError`, …).
- `mini-react-repl/editor-monaco` adapter.
- `repl-vendor-build` CLI for building per-project vendor chunks; `mini-react-repl/vendor-default` ships a small react/react-dom default.
- swc-wasm transform pipeline + real React Fast Refresh in the iframe runtime.
- Built-in error overlay; `onPreviewError` callback for transform + runtime errors.
- `bodyHtml`, `swcWasmUrl`, custom `onAddFile` / `onDeleteFile` hooks.
