/**
 * SSR no-op stub for the Monaco adapter.
 *
 * Selected by the `node` export condition in `package.json`. Renders the
 * same outer container as the real adapter so server output matches what
 * the client mounts into — hydration stays clean. The real component
 * takes over on the client and Monaco populates the empty div via
 * `useEffect`.
 *
 * Lets consumers `import { MonacoReplEditor } from 'mini-react-repl/editor-monaco'`
 * unconditionally from server components without crashing on Monaco's
 * eager `window` access. Browser bundles still get the real adapter via
 * the `default` condition.
 *
 * @internal
 */

import type { MonacoReplEditorProps } from './index.tsx';

export type { MonacoReplEditorProps };

export function MonacoReplEditor(props: MonacoReplEditorProps): React.ReactElement {
  return (
    <div
      className={`repl-editor-monaco ${props.className ?? ''}`}
      style={{ width: '100%', height: '100%', ...props.style }}
    />
  );
}
