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
  /** Initial selected file. Defaults to `entry`. */
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
    }, [
      props.entry,
      props.vendor,
      props.swcWasmUrl,
      props.loader,
      props.virtualModules,
      bootConfig,
    ]);
  }

  const [activePath, setActivePath] = useState<string | null>(
    props.defaultActivePath ?? bootConfig.entry,
  );
  const [lastError, setLastError] = useState<ReplError | null>(null);

  // Latest-prop refs let us build CRUD callbacks once with stable identity.
  // The documented `useRepl` contract promises stable callbacks — putting
  // `props.files` in the dep array would break it on every keystroke.
  const filesRef = useRef(props.files);
  filesRef.current = props.files;
  const onFilesChangeRef = useRef(props.onFilesChange);
  onFilesChangeRef.current = props.onFilesChange;

  const setFile = useCallback((path: string, source: string) => {
    onFilesChangeRef.current({ ...filesRef.current, [path]: source });
  }, []);

  const removeFile = useCallback((path: string) => {
    const next = { ...filesRef.current };
    delete next[path];
    onFilesChangeRef.current(next);
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
    setActivePath((prev) => (prev === oldPath ? newPath : prev));
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
      setActivePath,
      setFile,
      removeFile,
      renameFile,
      setLastError,
    }),
    [bootConfig, setFile, removeFile, renameFile],
  );

  const state = useMemo<ReplStateContextValue>(
    () => ({
      files: props.files,
      activePath,
      lastError,
    }),
    [props.files, activePath, lastError],
  );

  return (
    <ReplActionsContext.Provider value={actions}>
      <ReplStateContext.Provider value={state}>{props.children}</ReplStateContext.Provider>
    </ReplActionsContext.Provider>
  );
}
