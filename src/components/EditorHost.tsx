/**
 * Internal: bridges an editor adapter (any component matching
 * {@link ReplEditorProps}) to the active file in context.
 *
 * @internal
 */

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ReplActionsContext, ReplStateContext } from './context.ts';
import { resolveValue } from './resolve.ts';
import { languageFor } from '../engine/path-utils.ts';
import type { LanguageMap, ReplEditorComponent, TypeBundle } from '../types.ts';

export type EditorHostProps = {
  editor: ReplEditorComponent;
  className?: string;
  style?: React.CSSProperties;
};

function isResolvedTypes(v: unknown): v is TypeBundle {
  return v != null && typeof v === 'object' && Array.isArray((v as { libs?: unknown }).libs);
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1);
}

function resolveLanguage(path: string, custom: LanguageMap | undefined): string {
  if (custom) {
    const hit = typeof custom === 'function' ? custom(path) : custom[extensionOf(path)];
    if (hit) return hit;
  }
  return languageFor(path);
}

export function EditorHost(props: EditorHostProps): React.ReactElement | null {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) throw new Error('<EditorHost/> must be inside <ReplProvider/>');

  // Vendor types arrive on their own timeline (independent of the import
  // map) so the editor can mount immediately and the .d.ts chunk fills in
  // diagnostics when it lands. Invoking `resolveValue` here, inside an
  // effect, keeps the chunk from being requested when no editor is mounted
  // — REPL-only consumers never reach this code.
  const rawTypes = actions.types;
  const [types, setTypes] = useState<TypeBundle | undefined>(() =>
    isResolvedTypes(rawTypes) ? rawTypes : undefined,
  );
  useEffect(() => {
    if (rawTypes === undefined) {
      setTypes(undefined);
      return;
    }
    const result = resolveValue(rawTypes, isResolvedTypes);
    if (isResolvedTypes(result)) {
      setTypes(result);
      return;
    }
    let cancelled = false;
    result.then((v) => {
      if (!cancelled) setTypes(v);
    });
    return () => {
      cancelled = true;
    };
  }, [rawTypes]);

  const path = state.activePath;
  const setFile = actions.setFile;

  // Stable onChange: identity only changes when path swaps. Lets adapters
  // that put onChange in dep arrays behave.
  const onChange = useCallback(
    (next: string) => (path ? setFile(path, next) : undefined),
    [path, setFile],
  );

  const languagesRef = useRef(actions.languages);
  languagesRef.current = actions.languages;

  if (!path) return null;
  const value = state.files[path] ?? '';
  const Editor = props.editor;
  const virtualModules = actions.virtualModules;
  const hasVirtuals = Object.keys(virtualModules).length > 0;
  return (
    <div className={`repl-editor ${props.className ?? ''}`} style={props.style}>
      <Editor
        path={path}
        value={value}
        language={resolveLanguage(path, languagesRef.current)}
        onChange={onChange}
        files={state.files}
        {...(types ? { types } : {})}
        {...(hasVirtuals ? { virtualModules } : {})}
      />
    </div>
  );
}
