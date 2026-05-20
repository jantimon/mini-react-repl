/**
 * SSR no-op stub for the Monaco adapter.
 *
 * Selected by the `node` export condition in `package.json`. Mirrors the
 * real adapter's JSX shape (container div + optional `<ColorSchemeWatcher>`)
 * so server output matches what the client mounts into — hydration stays
 * clean. The real component takes over on the client and Monaco populates
 * the empty container via `useEffect`.
 *
 * Fragment child count and order must match the client: a single-element
 * SSR output against a two-child client Fragment trips React hydration.
 * The watcher is SSR-safe — its render is pure JSX and all browser work
 * happens in its ref callback, which doesn't fire on the server.
 *
 * Lets consumers `import { MonacoReplEditor } from 'mini-react-repl/editor-monaco'`
 * unconditionally from server components without crashing on Monaco's
 * eager `window` access. Browser bundles still get the real adapter via
 * the `default` condition.
 *
 * @internal
 */

import { ColorSchemeWatcher } from '../ColorSchemeWatcher.tsx';
import type { MonacoReplEditorProps } from './index.tsx';

export type { MonacoReplEditorProps };

const NOOP_ON_CHANGE = () => {};

export function MonacoReplEditor(props: MonacoReplEditorProps): React.ReactElement {
  return (
    <>
      <div
        className={`repl-editor-monaco ${props.className ?? ''}`}
        style={{ width: '100%', height: '100%', ...props.style }}
      />
      {props.theme === undefined && <ColorSchemeWatcher onChange={NOOP_ON_CHANGE} />}
    </>
  );
}
