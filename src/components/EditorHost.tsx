/**
 * Internal: bridges an editor adapter (any component matching
 * {@link ReplEditorProps}) to the active file in context.
 *
 * @internal
 */

import { useCallback, useContext } from 'react';
import { ReplActionsContext, ReplStateContext } from './context.ts';
import { languageFor } from '../engine/path-utils.ts';
import type { ReplEditorComponent } from '../types.ts';

export type EditorHostProps = {
  editor: ReplEditorComponent;
  className?: string;
  style?: React.CSSProperties;
};

export function EditorHost(props: EditorHostProps): React.ReactElement | null {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) throw new Error('<EditorHost/> must be inside <ReplProvider/>');
  const path = state.activePath;
  const setFile = actions.setFile;

  // Stabilize onChange: identity changes only when path swaps (setFile is
  // already stable). Lets adapters that put onChange in dep arrays behave.
  const onChange = useCallback(
    (next: string) => {
      if (path) setFile(path, next);
    },
    [path, setFile],
  );

  if (!path) return null;
  const value = state.files[path] ?? '';
  const Editor = props.editor;
  return (
    <div className={`repl-editor ${props.className ?? ''}`} style={props.style}>
      <Editor
        path={path}
        value={value}
        language={languageFor(path)}
        onChange={onChange}
        files={state.files}
        {...(actions.vendor.types ? { types: actions.vendor.types } : {})}
      />
    </div>
  );
}
