/**
 * `mini-react-repl` — browser-only React TSX REPL.
 *
 * Public entry point. Components, hooks, and types for assembling an
 * editor + preview surface.
 *
 * Subpath imports for opt-in pieces:
 *   - `mini-react-repl/editor-monaco`  — Monaco-based editor adapter
 *   - `mini-react-repl/inspect`        — element-to-source picker
 *   - `mini-react-repl/cdn-esmsh`      — esm.sh resolver for the `cdn` prop
 *   - `mini-react-repl/loader`         — `defaultLoader` for custom loaders
 *   - `mini-react-repl/vendor-default` — curated default vendor bundle
 *   - `mini-react-repl/vendor-base`    — required-core re-export for custom vendors
 *   - `mini-react-repl/preview-html`   — preview-document HTML generator (advanced)
 *   - `mini-react-repl/theme.css`      — optional default styling
 *
 * The `repl-vendor-build` CLI (shipped as a `bin`) is the supported way to
 * produce a custom vendor bundle. There is no public Node API.
 *
 * @public
 */

export { Repl, type ReplProps } from './components/Repl.tsx';
export { ReplProvider, type ReplProviderProps } from './components/ReplProvider.tsx';
export { ReplPreview, DEFAULT_SANDBOX, type ReplPreviewProps } from './components/ReplPreview.tsx';
export { ReplFileTabs, type ReplFileTabsProps } from './components/ReplFileTabs.tsx';
export { ReplErrorOverlay, type ReplErrorOverlayProps } from './components/ReplErrorOverlay.tsx';
export { EditorHost, type EditorHostProps } from './components/EditorHost.tsx';
export {
  ColorSchemeWatcher,
  type ColorScheme,
  type ColorSchemeWatcherProps,
} from './ColorSchemeWatcher.tsx';
export { useRepl, type UseReplReturn } from './hooks/useRepl.ts';
export { useReplError, type UseReplErrorReturn } from './hooks/useReplError.ts';
export type {
  Files,
  VendorBundle,
  VirtualModules,
  ImportMap,
  LanguageMap,
  ReplError,
  ReplEditorProps,
  ReplEditorComponent,
  Resolvable,
  TypeBundle,
  ReplLoader,
  ReplLoaderInput,
  ReplLoaderResult,
  ReplTransform,
  ReplTransformOptions,
  ReplCdnResolver,
} from './types.ts';
