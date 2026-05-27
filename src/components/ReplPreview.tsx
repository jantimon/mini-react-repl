/**
 * Renders the preview iframe and owns the transform pipeline.
 *
 * Mounting: generates a srcdoc from the vendor + headHtml/bodyHtml inputs.
 * The srcdoc is recomputed only when those inputs change — never on file
 * edits. File edits flow through `postMessage` to the already-mounted iframe.
 *
 * Lifecycle inside this component:
 *   1. mount → generate srcdoc → iframe loads
 *   2. iframe runtime sends `ready`
 *   3. we boot the transform client (initializes swc-wasm in a worker)
 *   4. cold transform of every code file in dependency order
 *   5. send a single `boot` message containing all module URLs + CSS
 *   6. subsequent file changes flow through `client.syncFiles()`
 *
 * @public
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ReplActionsContext, ReplStateContext } from './context.ts';
import { generatePreviewHtml } from '../preview-html.ts';
import {
  TransformClient,
  type ModulePayload,
  type TransformError,
} from '../engine/transform-client.ts';
import type { ToIframe, FromIframe } from '../runtime/protocol.ts';
import type { ReplError } from '../types.ts';
import { SHELL_PATH, withShellFile } from './shell.ts';

export type ReplPreviewProps = {
  headHtml?: string;
  bodyHtml?: string;
  showPreviewErrorOverlay?: boolean;
  onPreviewError?: (err: ReplError) => void;
  onMounted?: () => void;
  /**
   * Forwarded to the underlying `<iframe>` element. Accepts an object ref
   * (`useRef<HTMLIFrameElement>(null)`) or a callback ref. Use it together
   * with `onMounted` to `postMessage` host-computed data into the iframe
   * (e.g. SQL results, theme, env). Note that messages with
   * `{ __repl: true, ... }` are reserved for the library's runtime
   * protocol — pick a different shape for your own messages.
   */
  iframeRef?: React.Ref<HTMLIFrameElement>;
  /**
   * Sandbox tokens applied to the underlying `<iframe>`. Default:
   * `'allow-scripts allow-forms'`. User code runs cross-origin to the
   * embedder and cannot read parent cookies, DOM, or storage. `allow-forms`
   * is included so `<form onSubmit>` handlers fire — Chromium blocks the
   * submit event entirely without it. `allow-same-origin`,
   * `allow-top-navigation`, and `allow-popups` are deliberately excluded.
   *
   * Set to `null` to drop the sandbox attribute entirely — required for
   * features that need same-origin DOM access (e.g. external test runners
   * reaching into `iframe.contentDocument`). Doing so makes user code
   * same-origin with the embedder and able to act as the embedder.
   */
  sandbox?: string | null;
  /**
   * Permissions-Policy delegated to the iframe via the `allow` attribute.
   * Default: `''` (deny all delegated features).
   */
  allow?: string;
  /**
   * Referrer policy for outbound requests from the iframe.
   * Default: `'no-referrer'`.
   */
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Public wrapper. Re-keys the inner component on every `reloadPreview()` so
 * a hard reload tears down the {@link TransformClient} + worker and mounts
 * a fresh one (the documented recovery hatch). Boot config — `swcWasmUrl`,
 * `loader`, `virtualModules` — is documented as boot-time-only and not
 * included in the key; consumers who need to change it must remount the
 * provider via the documented `key` escape hatch.
 */
export function ReplPreview(props: ReplPreviewProps): React.ReactElement {
  const state = useContext(ReplStateContext);
  if (!state) throw new Error('<ReplPreview/> must be inside <ReplProvider/>');
  return <ReplPreviewInner key={state.previewReloadKey} {...props} />;
}

function ReplPreviewInner(props: ReplPreviewProps): React.ReactElement {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) throw new Error('<ReplPreview/> must be inside <ReplProvider/>');

  const setLastError = actions.setLastError;
  const entry = actions.entry;
  const swcWasmUrl = actions.swcWasmUrl;
  const loader = actions.loader;
  const virtualModulesRaw = actions.virtualModules;
  const customShell = actions.shell;
  const importMap = actions.importMap;

  // The iframe runtime mounts a synthetic shell module — never the user's
  // entry directly. `filesForEngine` is the engine-side file table (user
  // files + injected `ReplShell.tsx`); `state.files` stays user-owned, so
  // tabs / Monaco / consumers see only what the consumer passed in.
  const filesForEngine = useMemo(
    () => withShellFile(state.files, entry, customShell),
    [state.files, entry, customShell],
  );
  const filesForEngineRef = useRef(filesForEngine);
  filesForEngineRef.current = filesForEngine;

  const showOverlay = props.showPreviewErrorOverlay !== false;
  const onErrorRef = useRef(props.onPreviewError);
  onErrorRef.current = props.onPreviewError;
  const onMountedRef = useRef(props.onMounted);
  onMountedRef.current = props.onMounted;
  // Stash the consumer's iframeRef so its identity changes don't churn the
  // iframe lifecycle below. Forwarding happens inside `setupIframe` so
  // consumers see the iframe attached at ref-phase timing (before the first
  // useLayoutEffect), matching the contract of a normal forwarded ref.
  const iframeRefBox = useRef(props.iframeRef);
  iframeRefBox.current = props.iframeRef;

  // `TransformClient` lives for the entire inner mount, owning the worker
  // across iframe attach cycles. Created inside `useEffect` (not `useState`
  // init) so React 18 strict mode's simulated unmount/remount disposes the
  // first instance cleanly and the remount produces a fresh one — useState
  // init would only run once, leaving a disposed client in state.
  //
  // `prewarm()` is called immediately so worker.js + swc-wasm download in
  // parallel with vendor resolution — independent of when `actions.importMap`
  // lands. Pure side effect on the network; the eventual session's
  // `transformAll()` reuses the cached `workerReady` promise.
  const [client, setClient] = useState<TransformClient | null>(null);
  useEffect(() => {
    const c = new TransformClient({
      ...(swcWasmUrl ? { swcWasmUrl } : {}),
      ...(loader ? { loader } : {}),
      ...(Object.keys(virtualModulesRaw).length > 0 ? { virtualModules: virtualModulesRaw } : {}),
    });
    void c.prewarm().catch(() => {});
    setClient(c);
    return () => {
      c.dispose();
      setClient((cur) => (cur === c ? null : cur));
    };
    // Boot config is documented boot-time-only — consumers must remount the
    // provider (via `key`) to change it. Including these in deps would cause
    // a fresh client + worker on every consumer render if they pass inline
    // objects/functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tracks the active iframe session's client for the `syncFiles` effect
  // below — null between iframe attaches, set during a session. Mirrors the
  // pre-refactor "syncFiles only fires when an iframe is attached" semantic
  // by gating on this ref rather than on `filesForEngine`'s deps.
  const sessionClientRef = useRef<TransformClient | null>(null);

  // Memoize srcdoc so file edits don't recompute / remount the iframe.
  // Gated on both `importMap` (needed for the inlined `<script type="importmap">`)
  // and `client` (the worker that compiles user code once the iframe sends
  // `ready`). When either is missing we render a placeholder so the iframe
  // mount + `setupIframe` fire only when there's a real client to attach.
  const srcdoc = useMemo(
    () =>
      importMap === null || client === null
        ? null
        : generatePreviewHtml({
            importMap,
            ...(props.headHtml !== undefined ? { headHtml: props.headHtml } : {}),
            ...(props.bodyHtml !== undefined ? { bodyHtml: props.bodyHtml } : {}),
            showErrorOverlay: showOverlay,
          }),
    [importMap, client, props.headHtml, props.bodyHtml, showOverlay],
  );

  // React 19 callback ref with cleanup. Synchronous with iframe mount/unmount —
  // listener and session are attached at the same time the `<iframe>` enters
  // the DOM, so there is no window where the iframe could send `ready` before
  // we're listening for it.
  const setupIframe = useCallback(
    (iframe: HTMLIFrameElement) => {
      // The iframe element only renders when both `client` and `importMap`
      // are non-null (see `srcdoc` memo above), so this guard is defensive —
      // it can't fire in practice, but it lets TypeScript narrow `client`
      // for the rest of the callback.
      if (!client) return;
      // Forward to the consumer's iframeRef. Read via the ref box so this
      // callback's deps don't include `props.iframeRef` (which would tear
      // down + re-attach the session on every consumer render when an
      // inline callback ref is used).
      const userRef = iframeRefBox.current;
      let detachUserRef: (() => void) | undefined;
      if (userRef) {
        if (typeof userRef === 'function') {
          const ret = userRef(iframe);
          // React 19 callback refs may return a cleanup; prefer it. Otherwise
          // we manually call the ref with null on detach.
          detachUserRef = typeof ret === 'function' ? ret : () => userRef(null);
        } else {
          (userRef as React.MutableRefObject<HTMLIFrameElement | null>).current = iframe;
          detachUserRef = () => {
            (userRef as React.MutableRefObject<HTMLIFrameElement | null>).current = null;
          };
        }
      }

      // Publish to the provider-shared registry so siblings like
      // `<InspectMode/>` can find the live iframe.
      actions.iframeRegistry.setIframe(iframe);

      // Per-iframe boot-protocol state. Lives in this callback's closure and
      // is referenced by the session handlers + message listener.
      let disposed = false;
      let booted = false;
      let ready = false;
      const queue: ToIframe[] = [];
      const collected: ModulePayload[] = [];
      const collectedCss: { path: string; css: string }[] = [];

      const send = (msg: ToIframe) => {
        if (!ready) {
          queue.push(msg);
          return;
        }
        iframe.contentWindow?.postMessage({ __repl: true, ...msg }, '*');
      };
      const flush = () => {
        const out = queue.splice(0);
        for (const m of out) iframe.contentWindow?.postMessage({ __repl: true, ...m }, '*');
      };

      const reportError = (err: ReplError) => {
        setLastError(err);
        onErrorRef.current?.(err);
      };

      const handleClientError = (e: TransformError) => {
        const err: ReplError =
          e.kind === 'resolve'
            ? { kind: 'resolve', path: e.path, specifier: e.specifier ?? '' }
            : {
                kind: 'transform',
                path: e.path,
                message: e.message,
                ...(e.loc ? { loc: e.loc } : {}),
              };
        reportError(err);
        if (e.kind === 'resolve') {
          send({ kind: 'resolve-error', path: e.path, specifier: e.specifier ?? '' });
        } else {
          send({
            kind: 'transform-error',
            path: e.path,
            message: e.message,
            ...(e.loc ? { loc: e.loc } : {}),
          });
        }
      };

      const { detach } = client.attachSession({
        onModule: (m) => {
          if (!booted) {
            collected.push(m);
          } else {
            send({ kind: 'load', module: m });
            // a successful module load implicitly clears prior transform errors
            // for that path; the iframe's overlay updates on the next tick.
            send({ kind: 'clear-errors' });
          }
        },
        onCssUpsert: (path, css) => {
          if (!booted) collectedCss.push({ path, css });
          else send({ kind: 'css-upsert', path, css });
        },
        onCssRemove: (path) => send({ kind: 'css-remove', path }),
        onError: handleClientError,
      });
      sessionClientRef.current = client;

      const onMessage = async (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.__repl !== true) return;
        // Security invariant: only accept messages from this iframe's window.
        // Without this check any other frame could spoof `__repl` envelopes.
        if (event.source !== iframe.contentWindow) return;
        const msg = data as FromIframe & { __repl: true };
        if (msg.kind === 'ready') {
          ready = true;
          // cold boot: transform everything and send one boot message.
          try {
            // record current files without scheduling per-file transforms;
            // transformAll() does the work in topological order.
            client.setFiles(filesForEngineRef.current);
            await client.transformAll();
            if (disposed) return;
            booted = true;
            iframe.contentWindow?.postMessage(
              {
                __repl: true,
                kind: 'boot',
                // The runtime entry is always the synthetic shell — never the
                // user-facing entry. The shell imports the latter (or whatever
                // a custom shell composes) and is what `root.render(...)` mounts.
                entry: SHELL_PATH,
                modules: collected.slice(),
                cssFiles: collectedCss.slice(),
              } satisfies ToIframe & { __repl: true },
              '*',
            );
            flush();
          } catch (err) {
            reportError({
              kind: 'runtime',
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? (err.stack ?? '') : '',
            });
          }
        } else if (msg.kind === 'mounted') {
          onMountedRef.current?.();
        } else if (msg.kind === 'runtime-error') {
          reportError({ kind: 'runtime', message: msg.message, stack: msg.stack });
        }
      };
      window.addEventListener('message', onMessage);

      return () => {
        disposed = true;
        window.removeEventListener('message', onMessage);
        detach();
        if (sessionClientRef.current === client) sessionClientRef.current = null;
        actions.iframeRegistry.setIframe(null);
        detachUserRef?.();
      };
    },
    [client, actions.iframeRegistry, setLastError],
  );

  // Forward file changes into the live transform client. Gated on
  // `sessionClientRef` so pre-iframe-mount edits (no session attached yet)
  // are dropped — the eventual session's cold-boot path picks up the
  // latest `filesForEngine` via `filesForEngineRef` instead.
  useEffect(() => {
    sessionClientRef.current?.syncFiles(filesForEngine);
  }, [filesForEngine]);

  return (
    <div className={`repl-preview ${props.className ?? ''}`} style={props.style}>
      {srcdoc === null ? (
        // ImportMap still pending. Render a same-shape placeholder so layout
        // doesn't shift when the iframe lands. Uses a distinct class from the
        // real iframe so `page.frameLocator('.repl-iframe')` doesn't latch
        // onto the placeholder during the importMap-pending window.
        <div
          className="repl-iframe-placeholder"
          aria-busy="true"
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <iframe
          ref={setupIframe}
          className="repl-iframe"
          srcDoc={srcdoc}
          title="preview"
          // `sandbox === null` is the explicit opt-out: react omits the
          // attribute and the iframe inherits the embedder's origin.
          sandbox={
            props.sandbox === null ? undefined : (props.sandbox ?? 'allow-scripts allow-forms')
          }
          allow={props.allow ?? ''}
          referrerPolicy={props.referrerPolicy ?? 'no-referrer'}
          // Inline so the iframe fills its container and drops the default
          // 2px inset border even when consumers don't import theme.css.
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      )}
    </div>
  );
}
