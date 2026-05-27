/**
 * Headless engine + context provider.
 *
 * Holds:
 *   - the active file selection (this is internal UI state, not project state)
 *   - the most recent error (mirrored from `<ReplPreview/>` for hook access)
 *   - boot config snapshot (vendor / entry / swcWasmUrl)
 *
 * Does NOT hold:
 *   - the file table — `files` prop is the source of truth
 *
 * @public
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReplActionsContext,
  ReplStateContext,
  type ReplActionsContextValue,
  type ReplIframeRegistry,
  type ReplStateContextValue,
} from './context.ts';
import type {
  Files,
  ImportMap,
  LanguageMap,
  VendorBundle,
  ReplError,
  ReplLoader,
  VirtualModules,
} from '../types.ts';

export type ReplProviderProps = {
  /** Source of truth for the file table. Required. */
  files: Files;
  /**
   * Called for every set / remove / rename action with the next files object.
   * The library does not debounce this — debounce on your side if it triggers
   * expensive work (IDB writes, server sync, history snapshots).
   */
  onFilesChange: (next: Files) => void;
  /**
   * Controlled active-file selection. When defined (including `null`), the
   * provider stops managing the active path internally; {@link onActivePathChange}
   * fires on every change request and your handler decides whether to apply it
   * by updating this prop. Mutually exclusive with {@link defaultActivePath}.
   *
   * Use this to sync the selection with a router, persist it across reloads,
   * or coordinate multiple panes.
   */
  activePath?: string | null;
  /**
   * Called whenever the active path *would* change.
   *
   * - **Controlled mode** ({@link activePath} is provided): your callback
   *   decides whether to apply the new value by updating `activePath`. The
   *   provider does not move the selection until you do.
   * - **Uncontrolled mode**: the provider has already moved the selection;
   *   the callback is informational (URL sync, telemetry, etc.).
   *
   * Fires for tab clicks, the "+" button, the post-delete fallback, and the
   * auto-shift after a rename of the currently active file.
   */
  onActivePathChange?: (next: string | null) => void;
  /**
   * Vendor bundle (import map + optional types). Required.
   *
   * Accepts any of the following so consumers can code-split the payload
   * with minimal boilerplate:
   *
   * - a sync `VendorBundle` (eager)
   * - a `Promise<{ default: VendorBundle }>` — pass the dynamic import
   *   e.g.: `import('mini-react-repl/vendor-default')`
   *
   * The bundle's `importMap` field can additionally be a thunk
   * (`() => Promise<ImportMap | { default: ImportMap }>`) — what
   * `repl-vendor-build` emits by default. The provider invokes the thunk
   * on first render so the bundler code-splits the import-map JSON into
   * its own chunk; the iframe boots once the chunk lands.
   *
   * The provider always renders its children. While the bundle is pending,
   * `<ReplPreview/>` shows a sized placeholder until the import map lands;
   * `<EditorHost/>` mounts without vendor types until the bundle resolves
   * (types unblock as soon as the outer bundle is in hand, independent of
   * the import-map resolution). File CRUD (`useRepl`, `<ReplFileTabs/>`)
   * is unaffected and works immediately.
   *
   * **Boot-time only after resolution.** Latched on first resolution.
   * Subsequent identity changes are ignored (a dev-mode warning fires). To
   * swap vendors, remount the provider with a `key` prop.
   */
  vendor: VendorBundle | PromiseLike<VendorBundle | { default: VendorBundle }>;
  /**
   * Logical path of the entry module. **Boot-time only.** See {@link vendor}.
   * @defaultValue `'App.tsx'`
   */
  entry?: string;
  /**
   * Self-hosted swc-wasm URL. **Boot-time only.** See {@link vendor}.
   */
  swcWasmUrl?: string;
  /**
   * Optional pre-processor invoked once per file. Lets you turn arbitrary
   * file types (`.sqlite`, `.md`, `.json`, ...) into a JS module or CSS the
   * REPL can execute. Return `null` to fall through to the built-in
   * extension-based dispatch. **Boot-time only.** See {@link vendor}.
   */
  loader?: ReplLoader;
  /**
   * Inline virtual modules: map of import specifier (e.g. `'@app/util'`)
   * to TSX source. User code can `import { x } from '@app/util'` and the
   * iframe runtime executes the compiled source; Monaco autocompletes
   * against it. No bundling, hosting, or import-map entry required.
   *
   * **Boot-time only.** See {@link vendor}. Hoist to a top-level `as const`
   * so the reference stays stable; identity changes after mount fire a
   * dev-warning and are ignored. Collisions with `vendor.importMap.imports`
   * keys resolve in favor of the virtual. CSS aliases (`*.css`) are rejected
   * with a `console.error` for now.
   */
  virtualModules?: VirtualModules;
  /**
   * TSX source for the synthetic root component the iframe mounts (the
   * "shell"). Use this to wrap user code in a `<Suspense>` boundary, error
   * boundary, theme provider, etc., without forcing the consumer to author
   * (or know about) the wrapping in their own files.
   *
   * If omitted, the library generates a pass-through shell that simply
   * renders the entry component — visually identical to today's behavior.
   *
   * The string is compiled with the same swc pipeline as user files and
   * injected as `ReplShell.tsx` in the engine's file table. It can do
   * relative imports against user files (e.g. `import App from './App'`)
   * and bare imports through the import map. Drop a `ReplShell.tsx` into
   * `files` directly to take over from this prop and edit the shell live.
   *
   * **Boot-time only.** See {@link vendor}.
   */
  shell?: string;
  /**
   * Map a file path to an editor language id. Pair with a custom
   * {@link loader} to teach the editor about file types it doesn't
   * recognize — e.g. `.md` → `'markdown'`, `.json` → `'json'`.
   *
   * Accepts a record keyed by extension (no leading dot) or a function:
   *
   * ```tsx
   * <Repl languages={{ md: 'markdown', json: 'json' }} ... />
   * <Repl languages={(path) => path.endsWith('.svg') ? 'xml' : undefined} ... />
   * ```
   *
   * Falls back to the built-in dispatch (`.css` → `'css'`, `.js`/`.jsx`/
   * `.mjs` → `'javascript'`, everything else → `'typescript'`) for
   * unknown extensions / `undefined` returns. The host stores the value
   * in a ref and consults it on every active-file change; mappings are
   * not expected to change at runtime, but identity changes are tolerated.
   */
  languages?: LanguageMap;
  /**
   * Initial selected file in uncontrolled mode. Ignored when
   * {@link activePath} is provided. Defaults to {@link entry}.
   */
  defaultActivePath?: string;
  children?: React.ReactNode;
};

function normalizeVirtualModules(input: VirtualModules): VirtualModules {
  const raw: VirtualModules = {};
  for (const [alias, source] of Object.entries(input)) {
    if (alias.endsWith('.css')) {
      // eslint-disable-next-line no-console
      console.error(
        `[mini-react-repl] virtualModules['${alias}']: CSS aliases are not yet supported. ` +
          `Skipping. (Tracked for a future minor release.)`,
      );
      continue;
    }
    raw[alias] = source;
  }
  return raw;
}

function isThenable<T>(v: unknown): v is PromiseLike<T> {
  return v != null && typeof (v as { then?: unknown }).then === 'function';
}

function unwrapDefault(v: VendorBundle | { default: VendorBundle }): VendorBundle {
  return 'importMap' in v ? v : v.default;
}

function isPlainImportMap(v: VendorBundle['importMap']): v is ImportMap {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { imports?: unknown }).imports === 'object' &&
    (v as { imports?: unknown }).imports !== null &&
    typeof (v as { then?: unknown }).then !== 'function'
  );
}

function unwrapImportMapDefault(v: ImportMap | { default: ImportMap }): ImportMap {
  return 'imports' in v ? v : v.default;
}

/**
 * Resolve `vendor.importMap` to a plain `ImportMap`. Sync if already plain;
 * otherwise calls the thunk / awaits the promise. Failure rejects.
 */
function resolveImportMap(input: VendorBundle['importMap']): Promise<ImportMap> | ImportMap {
  if (isPlainImportMap(input)) return input;
  const value = typeof input === 'function' ? input() : input;
  if (isPlainImportMap(value)) return value;
  return Promise.resolve(value).then(unwrapImportMapDefault);
}

/**
 * Wrap your editor + preview composition in this. Provides
 * {@link useRepl} and shared context to {@link ReplFileTabs},
 * {@link ReplPreview}, and any custom UIs.
 *
 * @example
 * ```tsx
 * <ReplProvider files={files} onFilesChange={setFiles} vendor={defaultVendor}>
 *   <ReplFileTabs />
 *   <MyEditor />
 *   <ReplPreview />
 * </ReplProvider>
 * ```
 */
export function ReplProvider(props: ReplProviderProps): React.ReactElement {
  const vendorProp = props.vendor;

  // The outer `vendor` prop has two independent async edges:
  //   1. the prop itself may be a Promise (`vendor={import('./vendor')}`)
  //   2. the bundle's `importMap` may be a thunk / Promise (the codegen
  //      default — keeps the import-map JSON in its own chunk).
  //
  // `importMap` and `types` resolve on independent timelines and are
  // surfaced through the actions context independently — `<ReplPreview/>`
  // needs the import map inlined in the iframe srcdoc; `<EditorHost/>` only
  // needs `types`. Sync-on-first-render for fully-sync bundles; promise-typed
  // inputs flow through the effect.
  const isVendorThenable = isThenable<VendorBundle | { default: VendorBundle }>(vendorProp);
  const initialImportMap: ImportMap | null =
    !isVendorThenable && isPlainImportMap(vendorProp.importMap) ? vendorProp.importMap : null;
  const initialTypes: VendorBundle['types'] | undefined = isVendorThenable
    ? undefined
    : vendorProp.types;

  const [importMap, setImportMap] = useState<ImportMap | null>(initialImportMap);
  const [types, setTypes] = useState<VendorBundle['types'] | undefined>(initialTypes);
  // True once the bundle has been resolved (sync prop OR promise fulfilled).
  // Subsequent prop changes warn in dev and are ignored — vendor is boot-time
  // only, like `entry` et al.
  const latchedRef = useRef<boolean>(initialImportMap !== null);

  useEffect(() => {
    if (latchedRef.current) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(
          '[mini-react-repl] <ReplProvider/> received a new `vendor` prop after first resolution. ' +
            'vendor is boot-time only; the change is ignored. ' +
            'To swap, remount the provider with a different `key` prop.',
        );
      }
      return;
    }

    let cancelled = false;
    const onError = (where: string, err: unknown): void => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.error(
        `[mini-react-repl] <ReplProvider/> ${where} rejected: ${
          err instanceof Error ? err.message : String(err)
        }. Preview will stay in its pending placeholder; pass a resolved vendor (or a promise that resolves) to recover.`,
      );
    };

    const finish = (bundle: VendorBundle): void => {
      if (cancelled) return;
      // Surface `types` immediately so `<EditorHost/>` can start the .d.ts
      // download in parallel with the import-map resolution. useState's
      // functional setter is needed because `bundle.types` itself may be
      // a function thunk, which the plain `setTypes(bundle.types)` form
      // would call as an updater.
      if (bundle.types) setTypes(() => bundle.types);
      const importMapResult = resolveImportMap(bundle.importMap);
      const settle = (map: ImportMap): void => {
        if (cancelled) return;
        latchedRef.current = true;
        setImportMap(map);
      };
      if (isPlainImportMap(importMapResult)) {
        settle(importMapResult);
        return;
      }
      importMapResult.then(settle, (err) => onError('vendor.importMap promise', err));
    };

    if (!isVendorThenable) {
      finish(vendorProp);
      return () => {
        cancelled = true;
      };
    }
    vendorProp.then(
      (v) => {
        if (cancelled) return;
        finish(unwrapDefault(v));
      },
      (err) => onError('vendor promise', err),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorProp]);

  return <ReplProviderInner {...props} importMap={importMap} types={types} />;
}

type ReplProviderInnerProps = Omit<ReplProviderProps, 'vendor'> & {
  importMap: ImportMap | null;
  types: VendorBundle['types'] | undefined;
};

function ReplProviderInner(props: ReplProviderInnerProps): React.ReactElement {
  // Boot config is snapshotted on first render. Subsequent prop changes are
  // ignored (with a dev-mode warning) because changing them post-mount would
  // require a full iframe + swc-wasm reboot. `vendor` is NOT in here — it
  // may legitimately arrive late via a promise (latched in the outer
  // `<ReplProvider/>`) and is forwarded through props on every render.
  const [bootConfig] = useState(() => ({
    entry: props.entry ?? 'App.tsx',
    swcWasmUrl: props.swcWasmUrl,
    loader: props.loader,
    virtualModulesProp: props.virtualModules,
    virtualModules: normalizeVirtualModules(props.virtualModules ?? {}),
    shell: props.shell,
    languages: props.languages,
  }));

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const warn = (name: string) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[mini-react-repl] <ReplProvider/> received a new \`${name}\` prop after mount. ` +
            `${name} is boot-time only; the change is ignored. ` +
            `To swap, remount the provider with a different \`key\` prop.`,
        );
      };
      if ((props.entry ?? 'App.tsx') !== bootConfig.entry) warn('entry');
      if (props.swcWasmUrl !== bootConfig.swcWasmUrl) warn('swcWasmUrl');
      if (props.loader !== bootConfig.loader) warn('loader');
      if (props.virtualModules !== bootConfig.virtualModulesProp) warn('virtualModules');
      if (props.shell !== bootConfig.shell) warn('shell');
      if (props.languages !== bootConfig.languages) warn('languages');
    }, [
      props.entry,
      props.swcWasmUrl,
      props.loader,
      props.virtualModules,
      props.shell,
      props.languages,
      bootConfig,
    ]);
  }

  const controlledActivePath = props.activePath;
  const isControlledActivePath = controlledActivePath !== undefined;
  const [internalActivePath, setInternalActivePath] = useState<string | null>(
    props.defaultActivePath ?? bootConfig.entry,
  );
  const activePath: string | null = isControlledActivePath
    ? controlledActivePath
    : internalActivePath;
  const [lastError, setLastError] = useState<ReplError | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);

  // Latest-prop refs let us build CRUD callbacks once with stable identity.
  // The documented `useRepl` contract promises stable callbacks — putting
  // `props.files` in the dep array would break it on every keystroke.
  const filesRef = useRef(props.files);
  filesRef.current = props.files;
  const onFilesChangeRef = useRef(props.onFilesChange);
  onFilesChangeRef.current = props.onFilesChange;
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;
  const isControlledActivePathRef = useRef(isControlledActivePath);
  isControlledActivePathRef.current = isControlledActivePath;
  const onActivePathChangeRef = useRef(props.onActivePathChange);
  onActivePathChangeRef.current = props.onActivePathChange;

  const setActivePath = useCallback((path: string) => {
    if (activePathRef.current === path) return;
    if (!isControlledActivePathRef.current) setInternalActivePath(path);
    onActivePathChangeRef.current?.(path);
  }, []);

  const setFile = useCallback((path: string, source: string) => {
    onFilesChangeRef.current({ ...filesRef.current, [path]: source });
  }, []);

  const removeFile = useCallback((path: string) => {
    const next = { ...filesRef.current };
    delete next[path];
    onFilesChangeRef.current(next);
  }, []);

  const reloadPreview = useCallback(() => {
    setLastError(null);
    setPreviewReloadKey((k) => k + 1);
  }, []);

  // Stable iframe registry: `<ReplPreview/>` writes the current iframe via
  // `setIframe`, siblings (e.g. `<InspectMode/>`) subscribe. Identity is
  // stable for the provider's lifetime so subscribers don't churn.
  const iframeRegistry = useMemo<ReplIframeRegistry>(() => {
    let current: HTMLIFrameElement | null = null;
    const listeners = new Set<(iframe: HTMLIFrameElement | null) => void>();
    return {
      getIframe: () => current,
      setIframe: (next) => {
        if (current === next) return;
        current = next;
        for (const cb of listeners) cb(next);
      },
      subscribe: (cb) => {
        listeners.add(cb);
        cb(current);
        return () => {
          listeners.delete(cb);
        };
      },
    };
  }, []);

  const renameFile = useCallback((oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;
    const files = filesRef.current;
    if (newPath in files) {
      throw new Error(`Cannot rename '${oldPath}' to '${newPath}': target already exists.`);
    }
    const next: Files = {};
    for (const [k, v] of Object.entries(files)) {
      next[k === oldPath ? newPath : k] = v;
    }
    onFilesChangeRef.current(next);
    if (activePathRef.current === oldPath) {
      if (!isControlledActivePathRef.current) setInternalActivePath(newPath);
      onActivePathChangeRef.current?.(newPath);
    }
  }, []);

  // Actions context — stable for the provider's lifetime. Consumers that
  // only read this don't re-render on file edits.
  const actions = useMemo<ReplActionsContextValue>(
    () => ({
      entry: bootConfig.entry,
      importMap: props.importMap,
      types: props.types,
      swcWasmUrl: bootConfig.swcWasmUrl,
      loader: bootConfig.loader,
      virtualModules: bootConfig.virtualModules,
      shell: bootConfig.shell,
      languages: bootConfig.languages,
      setActivePath,
      setFile,
      removeFile,
      renameFile,
      reloadPreview,
      setLastError,
      iframeRegistry,
    }),
    [
      bootConfig,
      props.importMap,
      props.types,
      setActivePath,
      setFile,
      removeFile,
      renameFile,
      reloadPreview,
      iframeRegistry,
    ],
  );

  const state = useMemo<ReplStateContextValue>(
    () => ({
      files: props.files,
      activePath,
      lastError,
      previewReloadKey,
    }),
    [props.files, activePath, lastError, previewReloadKey],
  );

  return (
    <ReplActionsContext.Provider value={actions}>
      <ReplStateContext.Provider value={state}>{props.children}</ReplStateContext.Provider>
    </ReplActionsContext.Provider>
  );
}
