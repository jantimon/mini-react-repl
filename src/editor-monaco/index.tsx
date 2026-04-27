/**
 * Monaco-based editor adapter.
 *
 * Imported from a separate subpath so consumers that bring their own editor
 * never pay for Monaco. `monaco-editor` is an optional peer dependency.
 *
 * **Worker setup is automatic.** This module assigns `self.MonacoEnvironment`
 * with a `getWorker` that spawns Monaco's TS / CSS / editor workers via
 * `new Worker(new URL('monaco-editor/...', import.meta.url), { type: 'module' })`.
 * Vite, webpack 5, Rspack, and Parcel 2 all statically analyze that pattern
 * and emit the workers as separate chunks — no plugin or setup file needed.
 *
 * **Opt out** by assigning `self.MonacoEnvironment` *before* importing this
 * module; the auto-setup is guarded and will not overwrite an existing value.
 *
 * **SSR-safe.** The package's `node` export condition resolves to a no-op
 * stub that renders the same outer container, so importing this module from
 * a server component (Next.js, Remix) does not crash on Monaco's eager
 * `window` access. The real adapter loads in the client bundle and takes
 * over on hydration.
 *
 * The adapter configures Monaco's TypeScript service on mount with compiler
 * options matching the runtime transform (automatic JSX, ES2022, bundler
 * resolution). Pass `compilerOptions` / `diagnosticsOptions` to override.
 * If `vendor.types` is present on the surrounding {@link Repl} /
 * {@link ReplProvider}, its `.d.ts` payload is registered here, giving real
 * diagnostics and hover signatures for vendor packages.
 *
 * @example
 * ```tsx
 * import { Repl } from 'mini-react-repl'
 * import { MonacoReplEditor } from 'mini-react-repl/editor-monaco'
 * <Repl editor={MonacoReplEditor} ... />
 * ```
 *
 * @public
 */

import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import type { ReplEditorProps, TypeBundle } from '../types.ts';

// Module-scope so it runs exactly once on first import, before any editor
// mounts. Guarded so consumers that wire their own workers (custom CDN paths,
// classic-worker fallbacks, etc.) by setting MonacoEnvironment first win.
if (typeof self !== 'undefined' && !self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'typescript' || label === 'javascript') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
          { type: 'module' },
        );
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url),
          { type: 'module' },
        );
      }
      return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), {
        type: 'module',
      });
    },
  };
}

export type MonacoReplEditorProps = ReplEditorProps & {
  /** Monaco theme. @defaultValue `'vs-dark'` if `prefers-color-scheme: dark`, else `'vs'` */
  theme?: string;
  /** Pass-through to monaco's `IStandaloneEditorConstructionOptions`. */
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  /**
   * Override the compiler options the adapter sets on
   * `monaco.typescript.typescriptDefaults`. Merged on top of the
   * library's defaults (automatic JSX, ES2022, bundler resolution, strict).
   *
   * **Boot-time only.** Applied once on the first mount; subsequent prop
   * changes are ignored. `setCompilerOptions` is global Monaco state and
   * invalidates every model's diagnostics, so re-applying on every render
   * (when consumers pass inline objects) thrashes the workspace.
   */
  compilerOptions?: monaco.typescript.CompilerOptions;
  /**
   * Override the diagnostics options. Defaults enable both syntax and
   * semantic validation. **Boot-time only.** See {@link compilerOptions}.
   */
  diagnosticsOptions?: monaco.typescript.DiagnosticsOptions;
  /**
   * Map a file path to a Monaco language ID. Consulted before the built-in
   * extension dispatch (`.css` → `css`, `.js`/`.jsx`/`.mjs` → `javascript`,
   * everything else → `typescript`). Return `undefined` for paths the
   * default dispatch should still handle.
   *
   * Use this for files served by a custom {@link ReplLoader} — e.g. map
   * `.md` to `'markdown'` for Monaco's bundled markdown grammar.
   *
   * @example
   * ```tsx
   * const MyMonaco = (props: ReplEditorProps) => (
   *   <MonacoReplEditor
   *     {...props}
   *     languageFor={(path) =>
   *       path.endsWith('.md') ? 'markdown'
   *       : path.endsWith('.json') ? 'json'
   *       : undefined
   *     }
   *   />
   * );
   * ```
   */
  languageFor?: (path: string) => string | undefined;
  className?: string;
  style?: React.CSSProperties;
};

const DEFAULT_COMPILER_OPTIONS: monaco.typescript.CompilerOptions = {
  jsx: monaco.typescript.JsxEmit.ReactJSX,
  jsxImportSource: 'react',
  // Monaco bundles a TS version older than the workspace's, so its enum
  // tops out at ESNext for both target and module. That covers ES2022.
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  // Monaco's enum has no `Bundler` member; NodeJs is the closest behaviour
  // and works for our `inmemory:///` model URIs + extra-libs registered
  // under `file:///node_modules/<pkg>/...`.
  moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
  allowNonTsExtensions: true,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  isolatedModules: true,
  strict: true,
  skipLibCheck: true,
  // TS lib names are lowercase; uppercase forms are silently ignored.
  lib: ['es2022', 'dom', 'dom.iterable'],
};

const DEFAULT_DIAGNOSTICS_OPTIONS: monaco.typescript.DiagnosticsOptions = {
  noSemanticValidation: false,
  noSyntaxValidation: false,
};

// Monaco's `addExtraLib` registers globally on `typescriptDefaults`, not
// per-editor. Ref-count by path so re-renders, StrictMode double-invoke,
// and multiple concurrent editor instances are all idempotent.
type LibEntry = {
  content: string;
  refCount: number;
  disposable: monaco.IDisposable;
};
const registeredLibs = new Map<string, LibEntry>();

function acquireLib(path: string, content: string): void {
  const existing = registeredLibs.get(path);
  if (existing) {
    if (existing.content === content) {
      existing.refCount += 1;
      return;
    }
    existing.disposable.dispose();
  }
  const disposable = monaco.typescript.typescriptDefaults.addExtraLib(content, path);
  registeredLibs.set(path, { content, refCount: 1, disposable });
}

function releaseLib(path: string): void {
  const entry = registeredLibs.get(path);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    entry.disposable.dispose();
    registeredLibs.delete(path);
  }
}

// Monaco's built-in TS diagnostics adapter only re-validates a model when
// *that* model's content changes — it doesn't follow the import graph. So
// when the user edits `Counter.tsx`, the markers on `App.tsx` (which
// imports it) stay frozen until App.tsx is touched.
//
// Round-trip to the TS worker for the active model and republish its
// markers ourselves. `getTypeScriptWorker(uri)` syncs the latest mirror
// model state into the worker, so the diagnostics we get back reflect the
// updated dependency. We write to the same marker owner Monaco's adapter
// uses (the language id) so subsequent edits to the active model overwrite
// our markers cleanly instead of stacking.
async function refreshActiveDiagnostics(
  model: monaco.editor.ITextModel,
  isStillCurrent: () => boolean,
): Promise<void> {
  const getWorker = await monaco.typescript.getTypeScriptWorker();
  if (!isStillCurrent() || model.isDisposed()) return;
  const worker = await getWorker(model.uri);
  if (!isStillCurrent() || model.isDisposed()) return;
  const uri = model.uri.toString();
  const [syntactic, semantic] = await Promise.all([
    worker.getSyntacticDiagnostics(uri),
    worker.getSemanticDiagnostics(uri),
  ]);
  if (!isStillCurrent() || model.isDisposed()) return;
  const markers = [...syntactic, ...semantic].map((d) => tsDiagnosticToMarker(d, model));
  monaco.editor.setModelMarkers(model, model.getLanguageId(), markers);
}

// Mirrors monaco-editor's `DiagnosticMessageChain` (declared in monaco.d.ts
// but not re-exported from the `typescript` namespace).
type DiagnosticMessageChain = { messageText: string; next?: DiagnosticMessageChain[] };

function flattenDiagnosticMessage(text: string | DiagnosticMessageChain, indent = 0): string {
  if (typeof text === 'string') return text;
  let result = indent === 0 ? text.messageText : '\n' + '  '.repeat(indent) + text.messageText;
  if (text.next) {
    for (const n of text.next) result += flattenDiagnosticMessage(n, indent + 1);
  }
  return result;
}

function tsDiagnosticToMarker(
  d: monaco.typescript.Diagnostic,
  model: monaco.editor.ITextModel,
): monaco.editor.IMarkerData {
  const start = model.getPositionAt(d.start ?? 0);
  const end = model.getPositionAt((d.start ?? 0) + (d.length ?? 0));
  const severity =
    d.category === 0
      ? monaco.MarkerSeverity.Warning
      : d.category === 1
        ? monaco.MarkerSeverity.Error
        : d.category === 2
          ? monaco.MarkerSeverity.Hint
          : monaco.MarkerSeverity.Info;
  return {
    severity,
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
    message: flattenDiagnosticMessage(d.messageText),
    code: d.code != null ? String(d.code) : undefined,
    source: d.source ?? 'ts',
  };
}

function defaultLanguageForPath(path: string): string {
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.mjs')) {
    return 'javascript';
  }
  return 'typescript';
}

function resolveLanguage(
  path: string,
  custom: ((p: string) => string | undefined) | undefined,
): string {
  return custom?.(path) ?? defaultLanguageForPath(path);
}

/**
 * Headless-spec editor adapter. Mounts a Monaco editor and bridges
 * `value` / `onChange` to the host's controlled state.
 */
export function MonacoReplEditor(props: MonacoReplEditorProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  // languageFor is consulted inside effects keyed on `files` / `path`. Capture
  // it in a ref so identity changes don't churn models — Monaco can't change
  // a model's language post-creation anyway, so changes only take effect on
  // the next add/swap.
  const languageForRef = useRef(props.languageFor);
  languageForRef.current = props.languageFor;
  // Generation counter so a slow worker round-trip from a previous sync
  // can't overwrite markers from a later one.
  const refreshGenRef = useRef(0);

  // Mount the editor once. TS compiler / diagnostics options are boot-time:
  // they're global Monaco state (setCompilerOptions invalidates every
  // model's diagnostics across the workspace), so applying them once with
  // the initial props avoids thrashing when consumers pass inline objects.
  // Monaco's defaults otherwise reject every .tsx file with 17004 ("--jsx
  // not provided") and every bare specifier with 2792 ("module not found").
  const compilerOptionsRef = useRef(props.compilerOptions);
  const diagnosticsOptionsRef = useRef(props.diagnosticsOptions);
  useEffect(() => {
    if (!containerRef.current) return;
    monaco.typescript.typescriptDefaults.setCompilerOptions({
      ...DEFAULT_COMPILER_OPTIONS,
      ...compilerOptionsRef.current,
    });
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
      ...DEFAULT_DIAGNOSTICS_OPTIONS,
      ...diagnosticsOptionsRef.current,
    });

    const theme =
      props.theme ??
      (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs');
    const editor = monaco.editor.create(containerRef.current, {
      automaticLayout: true,
      tabSize: 2,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      renderLineHighlight: 'all',
      theme,
      // JSX in Monaco uses the standard `typescript` language; richer
      // coloring (intrinsic vs. component tags, parameters, types) comes
      // from the TS worker's semantic-token provider, which is off by
      // default. Pair with bracket-pair colorization so deeply nested
      // JSX is easier to scan.
      'semanticHighlighting.enabled': true,
      bracketPairColorization: { enabled: true },
      ...props.options,
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;
      onChangeRef.current(model.getValue());
    });

    return () => {
      sub.dispose();
      editor.dispose();
      modelsRef.current.forEach((m) => m.dispose());
      modelsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register vendor `.d.ts` files. Re-runs only when the bundle identity
  // changes; paths are ref-counted globally so swap is exact.
  useEffect(() => {
    const types: TypeBundle | undefined = props.types;
    if (!types) return;
    const acquired: string[] = [];
    for (const lib of types.libs) {
      acquireLib(lib.path, lib.content);
      acquired.push(lib.path);
    }
    return () => {
      for (const path of acquired) releaseLib(path);
    };
  }, [props.types]);

  // Sync ALL workspace files to Monaco models, not just the active one.
  // Without this, `import { X } from './Y'` reports `2307` (module not
  // found) until the user opens Y in a tab. Active file's content is
  // synced separately below to preserve cursor/selection.
  useEffect(() => {
    if (!props.files) return;
    let nonActiveChanged = false;
    for (const [path, content] of Object.entries(props.files)) {
      let model = modelsRef.current.get(path);
      if (!model) {
        const uri = monaco.Uri.parse(`file:///workspace/${path}`);
        model = monaco.editor.createModel(
          content,
          resolveLanguage(path, languageForRef.current),
          uri,
        );
        modelsRef.current.set(path, model);
      } else if (path !== props.path && model.getValue() !== content) {
        model.setValue(content);
        nonActiveChanged = true;
      }
    }
    for (const [path, model] of modelsRef.current) {
      if (!(path in props.files) && path !== props.path) {
        model.dispose();
        modelsRef.current.delete(path);
        nonActiveChanged = true;
      }
    }

    if (nonActiveChanged) {
      const activeModel = modelsRef.current.get(props.path);
      const lang = activeModel?.getLanguageId();
      if (activeModel && (lang === 'typescript' || lang === 'javascript')) {
        const myGen = ++refreshGenRef.current;
        void refreshActiveDiagnostics(activeModel, () => myGen === refreshGenRef.current);
      }
    }
  }, [props.files, props.path]);

  // Swap the model when `path` changes; sync value when not actively editing.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    let model = modelsRef.current.get(props.path);
    if (!model) {
      // Use the `file://` scheme nested under a synthetic project root so
      // Monaco's NodeJs module resolution walks up to
      // `file:///node_modules/<pkg>/...` where `vendor.types` are registered.
      // Without `file:`, `import 'date-fns'` resolves to nothing; the nested
      // dir avoids root-path collisions with Monaco's own lib models.
      const uri = monaco.Uri.parse(`file:///workspace/${props.path}`);
      model = monaco.editor.createModel(
        props.value,
        resolveLanguage(props.path, languageForRef.current),
        uri,
      );
      modelsRef.current.set(props.path, model);
    }

    if (editor.getModel() !== model) {
      editor.setModel(model);
    }

    if (model.getValue() !== props.value) {
      // Preserve cursor / selection if possible.
      const sel = editor.getSelection();
      model.setValue(props.value);
      if (sel) editor.setSelection(sel);
    }
  }, [props.path, props.value, props.language]);

  return (
    <div
      ref={containerRef}
      className={`repl-editor-monaco ${props.className ?? ''}`}
      style={{ width: '100%', height: '100%', ...props.style }}
    />
  );
}
