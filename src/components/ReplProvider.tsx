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
  type ReplStateContextValue,
} from './context.ts';
import type {
  Files,
  LanguageMap,
  VendorBundle,
  ReplError,
  ReplLoader,
  TypeBundle,
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
   *   or with a custom vendor bundle: `import('./vendor/repl.vendor.json')`)
   *
   * The provider renders nothing until the promise resolves; once resolved
   * it boots normally.
   *
   * **Boot-time only.** Snapshotted on first mount (after promise resolution).
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

/**
 * If the vendor declares a hosted `typesUrl` and no inline `types`, kick off
 * a fetch and stash the resulting promise in `types`. {@link EditorHost}
 * already resolves promise-typed `types`, so the editor sees the registered
 * libs as soon as the network round-trip completes — in parallel to swc-wasm
 * boot, iframe mount, and Monaco initialization.
 */
function applyTypesUrl(v: VendorBundle): VendorBundle {
  if (v.types !== undefined || v.typesUrl === undefined) return v;
  const url = v.typesUrl;
  return {
    ...v,
    types: fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TypeBundle>;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[mini-react-repl] failed to load vendor types from '${url}': ${
            err instanceof Error ? err.message : String(err)
          }. Editor will boot without vendor type info.`,
        );
        return { libs: [] };
      }),
  };
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
export function ReplProvider(props: ReplProviderProps): React.ReactElement | null {
  const vendorProp = props.vendor;
  const [resolvedVendor, setResolvedVendor] = useState<VendorBundle | undefined>(() =>
    isThenable<VendorBundle | { default: VendorBundle }>(vendorProp)
      ? undefined
      : applyTypesUrl(vendorProp),
  );

  useEffect(() => {
    if (!isThenable<VendorBundle | { default: VendorBundle }>(vendorProp)) {
      setResolvedVendor(applyTypesUrl(vendorProp));
      return;
    }
    let cancelled = false;
    vendorProp.then((v) => {
      if (!cancelled) setResolvedVendor(applyTypesUrl(unwrapDefault(v)));
    });
    return () => {
      cancelled = true;
    };
  }, [vendorProp]);

  if (!resolvedVendor) return null;
  return <ReplProviderInner {...props} vendor={resolvedVendor} />;
}

type ReplProviderInnerProps = Omit<ReplProviderProps, 'vendor'> & { vendor: VendorBundle };

function ReplProviderInner(props: ReplProviderInnerProps): React.ReactElement {
  // Boot config is snapshotted on first render. Subsequent prop changes are
  // ignored (with a dev-mode warning) because changing them post-mount would
  // require a full iframe + swc-wasm reboot.
  const [bootConfig] = useState(() => ({
    entry: props.entry ?? 'App.tsx',
    vendor: props.vendor,
    swcWasmUrl: props.swcWasmUrl,
    loader: props.loader,
    virtualModulesProp: props.virtualModules,
    virtualModules: normalizeVirtualModules(props.virtualModules ?? {}),
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
      if (props.vendor !== bootConfig.vendor) warn('vendor');
      if (props.swcWasmUrl !== bootConfig.swcWasmUrl) warn('swcWasmUrl');
      if (props.loader !== bootConfig.loader) warn('loader');
      if (props.virtualModules !== bootConfig.virtualModulesProp) warn('virtualModules');
      if (props.languages !== bootConfig.languages) warn('languages');
    }, [
      props.entry,
      props.vendor,
      props.swcWasmUrl,
      props.loader,
      props.virtualModules,
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
      vendor: bootConfig.vendor,
      swcWasmUrl: bootConfig.swcWasmUrl,
      loader: bootConfig.loader,
      virtualModules: bootConfig.virtualModules,
      languages: bootConfig.languages,
      setActivePath,
      setFile,
      removeFile,
      renameFile,
      reloadPreview,
      setLastError,
    }),
    [bootConfig, setActivePath, setFile, removeFile, renameFile, reloadPreview],
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
