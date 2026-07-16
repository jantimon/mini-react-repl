/**
 * Internal context shared between `<ReplProvider/>` and the headless
 * components. Not exported from the package root.
 *
 * Split into two contexts to minimize re-renders:
 *
 *   - {@link ReplStateContext} — reactive state (files, activePath, lastError).
 *     Changes on every edit / tab swap / error.
 *   - {@link ReplActionsContext} — stable across the provider's lifetime:
 *     CRUD callbacks plus boot config (vendor, entry, swcWasmUrl) snapshotted
 *     on first mount. Components that only need actions or boot config don't
 *     re-render on file edits.
 *
 * @internal
 */

import { createContext } from 'react';
import type {
  Files,
  ImportMap,
  LanguageMap,
  ReplCdnResolver,
  ReplError,
  ReplLoader,
  Resolvable,
  TypeBundle,
  VirtualModules,
} from '../types.ts';

export type ReplStateContextValue = {
  /** Current file table (mirrors the consumer's `files` prop). */
  files: Files;
  /** Currently selected file path in the editor. */
  activePath: string | null;
  /**
   * Monotonic counter bumped by {@link ReplActionsContextValue.reloadPreview}.
   * `<ReplPreview/>` reads it as the iframe's `key` so a bump forces a full
   * unmount/remount → fresh `TransformClient` and cold boot.
   *
   * @internal
   */
  previewReloadKey: number;
};

export type ReplErrorContextValue = {
  /** The most recent error, or null if cleared. */
  lastError: ReplError | null;
};

/**
 * Registry that connects `<ReplPreview/>` to siblings (currently only
 * `<InspectMode/>`) that need a handle on the live iframe element. The
 * registry object identity is stable for the provider's lifetime; its
 * `getIframe()` and subscriber list update as iframes mount and unmount.
 *
 * Subscribers are called with the new iframe (or `null` on detach) and
 * also receive an immediate call with the current value when they
 * subscribe.
 *
 * @internal
 */
export type ReplIframeRegistry = {
  /** Read the currently registered iframe, or `null`. */
  getIframe: () => HTMLIFrameElement | null;
  /**
   * Register an iframe element. `<ReplPreview/>`'s callback ref calls
   * this with the element on mount and `null` on unmount.
   */
  setIframe: (next: HTMLIFrameElement | null) => void;
  /**
   * Subscribe to iframe changes. The callback is invoked synchronously
   * once with the current value. Returns an unsubscribe function.
   */
  subscribe: (cb: (iframe: HTMLIFrameElement | null) => void) => () => void;
};

export type ReplActionsContextValue = {
  /** Logical entry path (snapshotted on first mount). */
  entry: string;
  /**
   * Resolved import map. `null` until both the outer `vendor` prop AND its
   * `importMap` have resolved; set exactly once thereafter (subsequent prop
   * changes warn in dev and are ignored, matching the boot-time semantics
   * of {@link entry} et al). `<ReplPreview/>` inlines this into the iframe
   * srcdoc; until it lands, the preview shows a sized placeholder.
   */
  importMap: ImportMap | null;
  /**
   * The `vendor.types` value (still in its unresolved form — thunk, Promise,
   * default-wrapper, or sync `TypeBundle`). Surfaced as soon as the outer
   * vendor bundle is in hand, *before* `vendor.importMap` finishes resolving,
   * so the .d.ts chunk races the import-map chunk instead of serializing
   * behind it. `undefined` when the bundle has no `types` field or hasn't
   * resolved yet.
   */
  types: Resolvable<TypeBundle> | undefined;
  /** swc-wasm URL override (snapshotted on first mount). */
  swcWasmUrl: string | undefined;
  /** Whether Fast Refresh is wired up (snapshotted on first mount). */
  hmr: boolean;
  /** Optional file pre-processor (snapshotted on first mount). */
  loader: ReplLoader | undefined;
  /**
   * Optional CDN resolver for bare specifiers the vendor import map doesn't
   * cover (snapshotted on first mount). `<ReplPreview/>` pairs it with the
   * resolved import-map keys and hands both to the transform session. See
   * {@link ReplCdnResolver}.
   */
  cdn: ReplCdnResolver | undefined;
  /**
   * Inline virtual modules (alias → source). Snapshotted on first mount.
   * Always defined; defaults to `{}` when the consumer didn't pass any.
   * Both the engine (`<ReplPreview/>`) and the editor (`<EditorHost/>`)
   * consume this directly — the engine prefixes synthetic registry keys
   * internally.
   */
  virtualModules: VirtualModules;
  /**
   * Optional consumer-provided shell source. Snapshotted on first mount.
   * `<ReplPreview/>` injects this (or a generated default) as the synthetic
   * `ReplShell.tsx` file the iframe actually mounts. `undefined` means use
   * the default. See {@link ReplProviderProps.shell}.
   */
  shell: string | undefined;
  /**
   * Optional consumer-provided extension → editor-language-id mapping.
   * Snapshotted on first mount. {@link EditorHost} consults this before
   * the built-in extension dispatch.
   */
  languages: LanguageMap | undefined;

  setActivePath: (path: string) => void;
  setFile: (path: string, source: string) => void;
  removeFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  /**
   * Force a full cold boot of the preview iframe — drops the current
   * `TransformClient`, remounts the iframe, and re-runs every transform.
   * Use it as a recovery hatch when user code crashes the runtime past
   * what HMR can rescue (e.g. an empty entry file, a top-level throw).
   * Also clears {@link ReplStateContextValue.lastError}.
   */
  reloadPreview: () => void;

  /** Internal — `<ReplPreview/>` flushes errors here for `useRepl()` consumers. */
  setLastError: (err: ReplError | null) => void;

  /**
   * Iframe registry shared with `<InspectMode/>` and any other sibling
   * that needs to talk to the live preview iframe. See
   * {@link ReplIframeRegistry}.
   * @internal
   */
  iframeRegistry: ReplIframeRegistry;
};

export const ReplStateContext = createContext<ReplStateContextValue | null>(null);
export const ReplActionsContext = createContext<ReplActionsContextValue | null>(null);
export const ReplErrorContext = createContext<ReplErrorContextValue | null>(null);
