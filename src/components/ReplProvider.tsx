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
import type { Files, VendorBundle, ReplError } from '../types.ts';

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
   * Vendor bundle (import map + optional base URL). Required.
   *
   * **Boot-time only.** Snapshotted on first mount. Subsequent identity
   * changes are ignored (a dev-mode warning fires). To swap vendors, remount
   * the provider with a `key` prop.
   */
  vendor: VendorBundle;
  /**
   * Logical path of the entry module. **Boot-time only.** See {@link vendor}.
   * @defaultValue `'App.tsx'`
   */
  entry?: string;
  /**
   * Self-hosted swc-wasm URL. **Boot-time only.** See {@link vendor}.
   */
  swcWasmUrl?: string;
  /** Initial selected file. Defaults to `entry`. */
  defaultActivePath?: string;
  children?: React.ReactNode;
};

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
  // Boot config is snapshotted on first render. Subsequent prop changes are
  // ignored (with a dev-mode warning) because changing them post-mount would
  // require a full iframe + swc-wasm reboot.
  const [bootConfig] = useState(() => ({
    entry: props.entry ?? 'App.tsx',
    vendor: props.vendor,
    swcWasmUrl: props.swcWasmUrl,
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
    }, [props.entry, props.vendor, props.swcWasmUrl, bootConfig]);
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
