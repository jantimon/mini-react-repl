/**
 * `mini-react-repl` — browser-only React TSX REPL.
 *
 * Public entry point. Components, hooks, and types for assembling an
 * editor + preview surface.
 *
 * Subpath imports for opt-in pieces:
 *   - `mini-react-repl/editor-monaco`  — Monaco-based editor adapter
 *   - `mini-react-repl/vendor-default` — curated default vendor bundle
 *   - `mini-react-repl/vendor-builder` — programmatic vendor builder
 *   - `mini-react-repl/preview-html`   — srcdoc generator (advanced)
 *   - `mini-react-repl/theme.css`      — optional default styling
 *
 * @public
 */

export { Repl, type ReplProps } from './components/Repl.tsx';
export { ReplProvider, type ReplProviderProps } from './components/ReplProvider.tsx';
export { ReplPreview, type ReplPreviewProps } from './components/ReplPreview.tsx';
export { ReplFileTabs, type ReplFileTabsProps } from './components/ReplFileTabs.tsx';
export { ReplErrorOverlay, type ReplErrorOverlayProps } from './components/ReplErrorOverlay.tsx';
export { EditorHost, type EditorHostProps } from './components/EditorHost.tsx';
export { useRepl, type UseReplReturn } from './hooks/useRepl.ts';
export type {
  Files,
  VendorBundle,
  ImportMap,
  ReplError,
  ReplEditorProps,
  ReplEditorComponent,
  TypeBundle,
} from './types.ts';
