import { useEffect } from 'react';
import * as monaco from 'monaco-editor';
import { MonacoReplEditor } from 'mini-react-repl/editor-monaco';
import type { ReplEditorProps } from 'mini-react-repl';

// `ReplEditorComponent` only receives `path` / `value` / `onChange` etc., so
// there is no React-idiomatic ref to forward through `<Repl editor={...} />`.
// The example wraps the adapter, captures the (single) Monaco editor via
// Monaco's global registry, and exposes an imperative `revealEditorLine`
// that the inspect-pick handler can call. A module-level handle is fine
// here — this surface ships exactly one editor.
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let pending: { path: string; line: number; column: number } | null = null;

export function revealEditorLine(path: string, line: number, column = 1): void {
  pending = { path, line, column };
  // Apply immediately if the target file is already open; otherwise the
  // wrapper's effect below picks it up on the render that follows the
  // host's `setActivePath`.
  flush();
}

function flush(): void {
  if (!editor || !pending) return;
  const model = editor.getModel();
  if (!model || !model.uri.path.endsWith('/' + pending.path)) return;
  editor.revealLineInCenter(pending.line);
  editor.setPosition({ lineNumber: pending.line, column: pending.column });
  editor.focus();
  pending = null;
}

export function FocusableMonacoEditor(props: ReplEditorProps): React.ReactElement {
  useEffect(() => {
    // Effects run child-first, so MonacoReplEditor's `monaco.editor.create`
    // has already executed by the time this runs — pick up the existing
    // instance and listen for any future ones (StrictMode remount, etc.).
    editor = (monaco.editor.getEditors()[0] as monaco.editor.IStandaloneCodeEditor) ?? null;
    const sub = monaco.editor.onDidCreateEditor((e) => {
      editor = e as monaco.editor.IStandaloneCodeEditor;
    });
    return () => {
      sub.dispose();
      editor = null;
      pending = null;
    };
  }, []);

  // Child useEffect ([props.path, ...]) swaps the Monaco model, then this
  // parent effect runs — by which point a pending focus for the new path
  // can be applied against the freshly-active model.
  useEffect(() => {
    flush();
  }, [props.path]);

  return <MonacoReplEditor {...props} />;
}
