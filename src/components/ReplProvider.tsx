/**
 * Headless engine + context provider.
 *
 * Holds:
 *   - the active file selection (UI state, not project state)
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
  ReplErrorContext,
  ReplStateContext,
  type ReplActionsContextValue,
  type ReplErrorContextValue,
  type ReplIframeRegistry,
  type ReplStateContextValue,
} from './context.ts';
import { resolveValue } from './resolve.ts';
import type {
  Files,
  ImportMap,
  LanguageMap,
  Resolvable,
  TypeBundle,
  VendorBundle,
  ReplCdnResolver,
  ReplError,
  ReplLoader,
  VirtualModules,
} from '../types.ts';

type ReplProviderBaseProps = {
  /** Source of truth for the file table. Required. */
  files: Files;
  /**
   * Called on every set / remove / rename action with the next files object.
   * Not debounced by the library — debounce on your side if it triggers
   * expensive work (IDB writes, server sync, history snapshots).
   */
  onFilesChange: (next: Files) => void;
  /**
   * Vendor bundle (import map + optional types). Accepts a sync
   * {@link VendorBundle}, a dynamic import (`import('mini-react-repl/vendor-default')`),
   * or any other {@link Resolvable} shape — the library waits for it on mount.
   *
   * The bundle's `importMap` field can additionally resolve lazily via thunk
   * or Promise; the iframe boots once the import map lands. **Boot-time only
   * after resolution.** Subsequent identity changes warn in dev and are
   * ignored; remount the provider with a different `key` prop to swap.
   */
  vendor: Resolvable<VendorBundle>;
  /**
   * Logical path of the entry module. **Boot-time only.**
   * @defaultValue `'App.tsx'`
   */
  entry?: string;
  /** Self-hosted swc-wasm URL. **Boot-time only.** */
  swcWasmUrl?: string;
  /**
   * React Fast Refresh. `false` keeps its transforms out of the compiled
   * output — for a read-only preview whose files never change after boot.
   * Edits still apply, but each one re-boots the preview and loses component
   * state. **Boot-time only.**
   *
   * @defaultValue `true`
   */
  hmr?: boolean;
  /**
   * Pre-processor invoked once per file. Lets you turn arbitrary file types
   * (`.sqlite`, `.md`, `.json`, ...) into a JS module or CSS. Return `null`
   * to fall through to the built-in extension dispatch. **Boot-time only.**
   */
  loader?: ReplLoader;
  /**
   * Resolve bare specifiers the prebuilt `vendor` import map doesn't cover by
   * lazy-loading them from a CDN on demand — opt-in arbitrary npm. Off by
   * default; without it, an unknown bare import errors as an unresolved module.
   *
   * Use `createEsmShCdnHandler()` from `mini-react-repl/cdn-esmsh`, or any
   * {@link ReplCdnResolver}. **Boot-time only.** Create it once at module
   * scope (a stable reference) — re-creating it on render tears down the
   * session; the library freezes it on first mount and warns in dev if the
   * identity changes.
   */
  cdn?: ReplCdnResolver;
  /**
   * Inline virtual modules: import specifier → TSX source. User code in the
   * REPL can `import { x } from '@app/util'`; the iframe runtime executes
   * the compiled source and Monaco autocompletes against it.
   *
   * **Boot-time only.** Hoist to a top-level `as const` so the reference
   * stays stable. Collisions with `vendor.importMap.imports` keys resolve
   * in favor of the virtual and warn in dev. CSS aliases (`*.css`) are
   * rejected.
   */
  virtualModules?: VirtualModules;
  /**
   * TSX source for the synthetic root component the iframe mounts (the
   * "shell"). Wrap user code in a `<Suspense>`, error boundary, or theme
   * provider without forcing the consumer to author the wrapping.
   *
   * Compiled with the same swc pipeline as user files and injected as
   * `ReplShell.tsx`. Drop a `ReplShell.tsx` into `files` directly to take
   * over from this prop and edit the shell live. **Boot-time only.**
   */
  shell?: string;
  /**
   * Map a file path to an editor language id. Pair with a custom
   * {@link loader} to teach the editor about file types it doesn't
   * recognize — e.g. `.md` → `'markdown'`, `.json` → `'json'`.
   *
   * Falls back to the built-in dispatch (`.css` → `'css'`, `.js`/`.jsx`/
   * `.mjs` → `'javascript'`, everything else → `'typescript'`) for unknown
   * extensions / `undefined` returns.
   *
   * ```tsx
   * <Repl languages={{ md: 'markdown', json: 'json' }} ... />
   * <Repl languages={(path) => path.endsWith('.svg') ? 'xml' : undefined} ... />
   * ```
   */
  languages?: LanguageMap;
  children?: React.ReactNode;
};

/**
 * Active-path control mode. Two shapes the type system enforces are
 * mutually exclusive:
 *
 * - **Uncontrolled** (no `activePath` prop): the provider owns the
 *   selection. Optionally seed with `defaultActivePath` and observe
 *   changes via `onActivePathChange`.
 * - **Controlled** (`activePath` provided, including `null`): the consumer
 *   owns the selection. `onActivePathChange` is required — when the user
 *   clicks a tab the library calls it; the consumer decides whether to
 *   update `activePath`. Mutually exclusive with `defaultActivePath`.
 */
type ActivePathProps =
  | {
      activePath?: undefined;
      defaultActivePath?: string;
      onActivePathChange?: (next: string | null) => void;
    }
  | {
      activePath: string | null;
      defaultActivePath?: never;
      onActivePathChange: (next: string | null) => void;
    };

export type ReplProviderProps = ReplProviderBaseProps & ActivePathProps;

function normalizeVirtualModules(input: VirtualModules): VirtualModules {
  const raw: VirtualModules = {};
  for (const [alias, source] of Object.entries(input)) {
    if (alias.endsWith('.css')) {
      // eslint-disable-next-line no-console
      console.error(
        `[mini-react-repl] virtualModules['${alias}']: CSS aliases are not yet supported. Skipping.`,
      );
      continue;
    }
    raw[alias] = source;
  }
  return raw;
}

function isPlainBundle(v: unknown): v is VendorBundle {
  return typeof v === 'object' && v !== null && 'importMap' in v;
}

function isPlainImportMap(v: unknown): v is ImportMap {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { imports?: unknown }).imports === 'object' &&
    (v as { imports?: unknown }).imports !== null
  );
}

/**
 * Wrap your editor + preview composition in this. Provides {@link useRepl}
 * and shared context to {@link ReplFileTabs}, {@link ReplPreview}, and any
 * custom UIs.
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

  // The vendor prop and its `importMap` field resolve on independent
  // timelines so the .d.ts chunk can race the import-map chunk instead of
  // serializing behind it. `types` is surfaced as soon as the outer bundle
  // is in hand — *before* `vendor.importMap` finishes resolving — and the
  // editor adapter awaits it with `use()`.
  const initialBundle: VendorBundle | null = isPlainBundle(vendorProp) ? vendorProp : null;
  const initialImportMap: ImportMap | null =
    initialBundle && isPlainImportMap(initialBundle.importMap) ? initialBundle.importMap : null;

  const [importMap, setImportMap] = useState<ImportMap | null>(initialImportMap);
  const [types, setTypes] = useState<Resolvable<TypeBundle> | undefined>(initialBundle?.types);
  // Read straight off the bundle like `types`, so it lands no later than
  // `importMap` — and therefore before any transform, which waits on the
  // iframe, which waits on the import map.
  const [development, setDevelopment] = useState<boolean>(initialBundle?.development ?? true);
  // Latched once the bundle is fully resolved. Subsequent prop changes
  // warn in dev and are ignored — vendor is boot-time only, matching
  // `entry` et al.
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
      // Functional setter — `bundle.types` may itself be a thunk, which the
      // direct setter form would treat as an updater.
      if (bundle.types) setTypes(() => bundle.types);
      setDevelopment(bundle.development ?? true);
      const mapResult = resolveValue(bundle.importMap, isPlainImportMap);
      const settle = (map: ImportMap): void => {
        if (cancelled) return;
        latchedRef.current = true;
        setImportMap(map);
      };
      if (isPlainImportMap(mapResult)) settle(mapResult);
      else mapResult.then(settle, (err) => onError('vendor.importMap', err));
    };

    if (isPlainBundle(vendorProp)) {
      finish(vendorProp);
      return () => {
        cancelled = true;
      };
    }
    Promise.resolve(vendorProp as PromiseLike<VendorBundle | { default: VendorBundle }>).then(
      (v) => {
        if (cancelled) return;
        finish(isPlainBundle(v) ? v : v.default);
      },
      (err) => onError('vendor promise', err),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorProp]);

  return (
    <ReplProviderInner {...props} importMap={importMap} types={types} development={development} />
  );
}

type ReplProviderInnerProps = Omit<ReplProviderProps, 'vendor'> & {
  importMap: ImportMap | null;
  types: Resolvable<TypeBundle> | undefined;
  development: boolean;
};

function ReplProviderInner(props: ReplProviderInnerProps): React.ReactElement {
  // Boot config is snapshotted on first render. Changing post-mount would
  // require a full iframe + swc-wasm reboot. `vendor` is NOT here — it may
  // arrive late via a promise (latched in the outer provider) and is
  // forwarded through props on every render.
  const entry = useFreezeValue(props.entry ?? 'App.tsx', 'entry');
  const swcWasmUrl = useFreezeValue(props.swcWasmUrl, 'swcWasmUrl');
  const hmrProp = useFreezeValue(props.hmr ?? true, 'hmr');
  // A production React has no Refresh hook to bind to, so a prod vendor
  // settles it regardless of the prop. The vendor's fact beats the
  // consumer's preference; the reverse would just move the mismatch.
  const hmr = hmrProp && props.development;
  const loader = useFreezeValue(props.loader, 'loader');
  const cdn = useFreezeValue(props.cdn, 'cdn');
  const virtualModulesProp = useFreezeValue(props.virtualModules, 'virtualModules');
  const shell = useFreezeValue(props.shell, 'shell');
  const languages = useFreezeValue(props.languages, 'languages');
  const virtualModules = useMemo(
    () => normalizeVirtualModules(virtualModulesProp ?? {}),
    [virtualModulesProp],
  );

  // Dev-only: warn once when an explicit `hmr` is overruled by a production
  // vendor. Fires only for hmr={true} passed on purpose — the default is
  // silently settled by the bundle.
  const hmrWarnedRef = useRef(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (hmrWarnedRef.current) return;
    if (props.hmr !== true || props.development) return;
    hmrWarnedRef.current = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[mini-react-repl] <ReplProvider hmr={true}/> with a production vendor bundle. ' +
        'Production React ships no Refresh hook, so Fast Refresh is off; edits re-boot the preview. ' +
        'Build the vendor without `--prod` to get Fast Refresh back.',
    );
  }, [props.hmr, props.development]);

  // Dev-only: warn once when an importMap key is shadowed by a virtualModules
  // alias. Has to wait until the import map resolves; before that there's
  // nothing to compare. Latched via ref so it fires exactly once per mount.
  const shadowCheckedRef = useRef(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (shadowCheckedRef.current) return;
    if (!props.importMap) return;
    shadowCheckedRef.current = true;
    const importMapKeys = new Set(Object.keys(props.importMap.imports));
    for (const alias of Object.keys(virtualModulesProp ?? {})) {
      if (importMapKeys.has(alias)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[mini-react-repl] virtualModules['${alias}'] shadows a key in vendor.importMap.imports. ` +
            `The virtual wins; user code's import resolves to the inline source.`,
        );
      }
    }
  }, [props.importMap, virtualModulesProp]);

  const controlledActivePath = props.activePath;
  const isControlledActivePath = controlledActivePath !== undefined;
  const [internalActivePath, setInternalActivePath] = useState<string | null>(
    props.defaultActivePath ?? entry,
  );
  const activePath: string | null = isControlledActivePath
    ? controlledActivePath
    : internalActivePath;
  const [lastError, setLastError] = useState<ReplError | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);

  // Single "always-latest" bag of reactive props. The CRUD callbacks below
  // read through this ref so their identity stays stable while the values
  // they close over are fresh. The alternative — depending on `props.files`
  // etc. in `useCallback` deps — would break the documented `useRepl`
  // contract of stable callback identity on every keystroke.
  const latestRef = useRef({
    files: props.files,
    onFilesChange: props.onFilesChange,
    activePath,
    isControlledActivePath,
    onActivePathChange: props.onActivePathChange,
  });
  latestRef.current = {
    files: props.files,
    onFilesChange: props.onFilesChange,
    activePath,
    isControlledActivePath,
    onActivePathChange: props.onActivePathChange,
  };

  const setActivePath = useCallback((path: string) => {
    const latest = latestRef.current;
    if (latest.activePath === path) return;
    if (!latest.isControlledActivePath) setInternalActivePath(path);
    latest.onActivePathChange?.(path);
  }, []);

  const setFile = useCallback((path: string, source: string) => {
    const latest = latestRef.current;
    latest.onFilesChange({ ...latest.files, [path]: source });
  }, []);

  const removeFile = useCallback((path: string) => {
    const latest = latestRef.current;
    const next = { ...latest.files };
    delete next[path];
    latest.onFilesChange(next);
  }, []);

  const renameFile = useCallback((oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;
    const latest = latestRef.current;
    if (newPath in latest.files) {
      throw new Error(`Cannot rename '${oldPath}' to '${newPath}': target already exists.`);
    }
    const next: Files = {};
    for (const [k, v] of Object.entries(latest.files)) {
      next[k === oldPath ? newPath : k] = v;
    }
    latest.onFilesChange(next);
    if (latest.activePath === oldPath) {
      if (!latest.isControlledActivePath) setInternalActivePath(newPath);
      latest.onActivePathChange?.(newPath);
    }
  }, []);

  const reloadPreview = useCallback(() => {
    setLastError(null);
    setPreviewReloadKey((k) => k + 1);
  }, []);

  // Stable iframe registry: `<ReplPreview/>` writes the current iframe via
  // `setIframe`; siblings (e.g. `<InspectMode/>`) subscribe. Identity is
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

  const actions = useMemo<ReplActionsContextValue>(
    () => ({
      entry,
      importMap: props.importMap,
      types: props.types,
      development: props.development,
      swcWasmUrl,
      hmr,
      loader,
      cdn,
      virtualModules,
      shell,
      languages,
      setActivePath,
      setFile,
      removeFile,
      renameFile,
      reloadPreview,
      setLastError,
      iframeRegistry,
    }),
    [
      entry,
      props.importMap,
      props.types,
      props.development,
      swcWasmUrl,
      hmr,
      loader,
      cdn,
      virtualModules,
      shell,
      languages,
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
      previewReloadKey,
    }),
    [props.files, activePath, previewReloadKey],
  );

  const errorState = useMemo<ReplErrorContextValue>(() => ({ lastError }), [lastError]);

  return (
    <ReplActionsContext.Provider value={actions}>
      <ReplStateContext.Provider value={state}>
        <ReplErrorContext.Provider value={errorState}>{props.children}</ReplErrorContext.Provider>
      </ReplStateContext.Provider>
    </ReplActionsContext.Provider>
  );
}

/**
 * Freeze a single prop on first render. In dev, warn if the identity ever
 * changes — the library snapshots boot-time props (`entry`, `loader`, etc.)
 * once and ignores later edits; the warning tells the consumer to remount
 * via a different `key` instead.
 *
 * The effect body is a constant `false` branch in prod after minification,
 * so the warning code drops out of the production bundle.
 */
function useFreezeValue<T>(value: T, name: string): T {
  const [frozen] = useState<T>(() => value);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (value === frozen) return;
    // eslint-disable-next-line no-console
    console.warn(
      `[mini-react-repl] <ReplProvider/> received a new \`${name}\` prop after mount. ` +
        `Props are frozen on first render; the change is ignored. ` +
        `To swap, remount the provider with a different \`key\` prop.`,
    );
  }, [value, frozen, name]);
  return frozen;
}
