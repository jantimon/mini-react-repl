# Changelog

All notable changes to `mini-react-repl`. Dates are YYYY-MM-DD.

## 0.12.0 — 2026-05-10

### Changed

- Inspect overlay polish:
  - Soft blue-tinted shadow instead of a 2px border, with a 100ms show delay so the cursor passing through the iframe never flashes the overlay up, and a 120ms fade on both show and hide.
  - Glides between elements: `left`/`top`/`width`/`height` now animate (140ms ease) when the user hovers from one element to the next. The element stays mounted between hovers; the position snaps (transitions suppressed for one reflow) when re-appearing after a fade-out so it doesn't drift in from the previous target.
  - Forces `cursor: default` across the iframe document while inspect mode is active. User CSS cursors (`pointer` on links, `text` on inputs, etc.) imply actions that won't fire while picking — the single arrow matches DevTools' inspect mode.

## 0.11.0 — 2026-05-10

### Added

- **Inspect mode.** Click-to-source picker for the iframe preview: hover highlights React fibers, click resolves the JSX call site through the bundle's source map back to a user file/line/column. Imported separately so consumers who don't need it skip the picker chunk:
  ```tsx
  import { InspectMode } from 'mini-react-repl/inspect';
  ```
  Surfaced via `useRepl().inspect` (`enable()`, `disable()`, `onPick`). New e2e + unit tests cover fiber walk, stack parsing, and source-map mapping.
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
