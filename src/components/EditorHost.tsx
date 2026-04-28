/**
 * Internal: bridges an editor adapter (any component matching
 * {@link ReplEditorProps}) to the active file in context.
 *
 * @internal
 */

import { useCallback, useContext, useEffect, useState } from 'react';
import { ReplActionsContext, ReplStateContext } from './context.ts';
import { languageFor } from '../engine/path-utils.ts';
import type { ReplEditorComponent, TypeBundle } from '../types.ts';

export type EditorHostProps = {
  editor: ReplEditorComponent;
  className?: string;
  style?: React.CSSProperties;
};

function isResolvedTypes(v: unknown): v is TypeBundle {
  return v != null && typeof v === 'object' && Array.isArray((v as { libs?: unknown }).libs);
}

function unwrapTypesDefault(v: TypeBundle | { default: TypeBundle }): TypeBundle {
  return isResolvedTypes(v) ? v : v.default;
}

export function EditorHost(props: EditorHostProps): React.ReactElement | null {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) throw new Error('<EditorHost/> must be inside <ReplProvider/>');
  const path = state.activePath;
  const setFile = actions.setFile;

  // Resolve `vendor.types` once. It may be a sync TypeBundle, a Promise that
  // resolves to one, or a JSON-import shape (`{ default: TypeBundle }`) — the
  // latter shows up when consumers do `fetch('/.../repl.types.json').then(r =>
  // r.json())` or `import('./.../repl.types.json')`. Editors only see the
  // resolved value.
  const rawTypes = actions.vendor.types;
  const [types, setTypes] = useState<TypeBundle | undefined>(() =>
    isResolvedTypes(rawTypes) ? rawTypes : undefined,
  );
  useEffect(() => {
    if (rawTypes === undefined) {
      setTypes(undefined);
      return;
    }
    if (isResolvedTypes(rawTypes)) {
      setTypes(rawTypes);
      return;
    }
    let cancelled = false;
    Promise.resolve(rawTypes).then((v) => {
      if (!cancelled) setTypes(unwrapTypesDefault(v));
    });
    return () => {
      cancelled = true;
    };
  }, [rawTypes]);

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
        {...(types ? { types } : {})}
      />
    </div>
  );
}
