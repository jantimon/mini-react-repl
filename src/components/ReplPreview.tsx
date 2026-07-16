/**
 * Renders the preview iframe and owns the transform pipeline.
 *
 * The preview HTML is generated once per (vendor / headHtml / bodyHtml)
 * inputs, packed into a `blob:` URL, and assigned to `iframe.src` — DevTools
 * shows a short `blob:` URL instead of the full document. File edits flow
 * through `postMessage` to the already-mounted iframe.
 *
 * Lifecycle:
 *   1. mount → construct `TransformClient` (worker prewarms in parallel)
 *   2. import map lands → preview HTML is computed, wrapped in a Blob, and
 *      `iframe.src` is set to its `blob:` URL inside the iframe ref callback
 *   3. iframe runtime sends `ready` → session is attached and cold-boot fires
 *   4. cold boot finishes → single `boot` message sent with every module + CSS
 *   5. subsequent file changes flow through `session.setFiles(next)`
 *
 * Soft reloads (`headHtml` / `bodyHtml` / `showPreviewErrorOverlay` change):
 * the ref callback re-runs — old blob URL is revoked, session is detached,
 * a fresh blob URL + session attach drives a clean cold-boot. The worker
 * and `TransformClient` survive across soft reloads.
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
  type TransformSession,
} from '../engine/transform-client.ts';
import type { ToIframe, FromIframe } from '../runtime/protocol.ts';
import type { ReplError } from '../types.ts';
import { isFromPreview } from './host-message.ts';
import { SHELL_PATH, withShellFile } from './shell.ts';

/**
 * Default `sandbox` attribute the iframe ships with. `allow-scripts` so user
 * code runs; `allow-forms` so React `<form onSubmit>` handlers fire
 * (Chromium blocks the submit event without it). `allow-same-origin`,
 * `allow-top-navigation`, and `allow-popups` are deliberately excluded —
 * user code runs cross-origin to the embedder.
 */
export const DEFAULT_SANDBOX = 'allow-scripts allow-forms';

export type ReplPreviewProps = {
  /**
   * Value for the preview document's `<base href>`. Root-relative URLs in
   * user code (e.g. `<img src="/img/x.png">`) resolve against this origin
   * instead of the sandboxed `blob:` origin, which has no server behind it.
   *
   * Defaults to the embedder's `window.location.origin`. Pass `null` to omit
   * the `<base>` tag entirely.
   */
  baseHref?: string | null;
  headHtml?: string;
  bodyHtml?: string;
  showPreviewErrorOverlay?: boolean;
  onPreviewError?: (err: ReplError) => void;
  onMounted?: () => void;
  /**
   * Forwarded to the underlying `<iframe>` element. Accepts an object ref
   * (`useRef<HTMLIFrameElement>(null)`) or a callback ref. Pair with
   * `onMounted` to `postMessage` host-computed data into the iframe.
   * Messages with `{ __repl: true, ... }` are reserved for the runtime
   * protocol — pick a different shape for your own.
   *
   * Fires once per preview document lifetime — including soft reloads
   * triggered by changes to `headHtml` / `bodyHtml` /
   * `showPreviewErrorOverlay`. The DOM element identity is preserved
   * across soft reloads, but the iframe's `contentWindow` is replaced and
   * any host state you `postMessage`-ed in is gone — re-send it from
   * `onMounted` or from your callback ref on each attach.
   */
  iframeRef?: React.Ref<HTMLIFrameElement>;
  /**
   * Sandbox tokens applied to the underlying `<iframe>`. Defaults to
   * {@link DEFAULT_SANDBOX} (`'allow-scripts allow-forms'`). Pass a custom
   * string to extend; pass {@link unsafeDropSandbox} to omit the attribute
   * entirely.
   */
  sandbox?: string;
  /**
   * **Use with care.** When `true`, the `sandbox` attribute is omitted
   * entirely — user code becomes same-origin with the embedder and can
   * read parent cookies, mutate the parent DOM, and act as the user.
   * Only set this in trusted contexts (test runners that need
   * `iframe.contentDocument`, internal tooling).
   */
  unsafeDropSandbox?: true;
  /**
   * Permissions-Policy delegated to the iframe via the `allow` attribute.
   * Defaults to `''` (deny all delegated features).
   */
  allow?: string;
  /**
   * Referrer policy for outbound requests from the iframe.
   * Defaults to `'no-referrer'`.
   */
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Public wrapper. Re-keys the inner component on every `reloadPreview()` so
 * a hard reload tears down the {@link TransformClient} + worker and mounts
 * a fresh one — the documented recovery hatch. Boot config
 * (`swcWasmUrl`, `loader`, `virtualModules`) is captured by the inner
 * component on first mount.
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
  const hmr = actions.hmr;
  const loader = actions.loader;
  const cdn = actions.cdn;
  const virtualModulesRaw = actions.virtualModules;
  const customShell = actions.shell;
  const importMap = actions.importMap;
  const iframeRegistry = actions.iframeRegistry;

  // The vendor import map's keys, verbatim. Drives the rewriter's
  // vendor-vs-CDN classification (exact + trailing-slash prefix match) and,
  // reduced to package names, becomes esm.sh's `?external` list so lazy
  // packages reuse our singletons. Trailing-slash prefix mappings are kept so
  // their subpaths classify as vendored — the rewriter owns the prefix
  // semantics and the package-name reduction.
  const vendorKeys = useMemo(
    () => (importMap ? new Set(Object.keys(importMap.imports)) : null),
    [importMap],
  );

  // The iframe runtime mounts a synthetic shell module — never the user's
  // entry directly. `filesForEngine` is the engine-side file table (user
  // files + injected `ReplShell.tsx`); `state.files` stays user-owned so
  // tabs / Monaco / consumers see only what the consumer passed in.
  const filesForEngine = useMemo(
    () => withShellFile(state.files, entry, customShell),
    [state.files, entry, customShell],
  );

  // Single "always-latest" prop bag. Read inside the iframe-lifetime
  // callback so changes to `onPreviewError` / `onMounted` / `iframeRef`
  // take effect without tearing down the session.
  const latestRef = useRef({
    onPreviewError: props.onPreviewError,
    onMounted: props.onMounted,
    iframeRef: props.iframeRef,
    filesForEngine,
  });
  latestRef.current = {
    onPreviewError: props.onPreviewError,
    onMounted: props.onMounted,
    iframeRef: props.iframeRef,
    filesForEngine,
  };

  const showOverlay = props.showPreviewErrorOverlay !== false;

  // `TransformClient` lives for the entire inner mount, owning the worker
  // across iframe attach cycles. Constructed inside `useEffect` so React 18
  // strict mode's simulated unmount/remount disposes the first instance
  // cleanly; useState-init would only run once, leaving a disposed client
  // in state on the remount.
  //
  // `prewarm()` runs immediately so worker.js + swc-wasm download in
  // parallel with vendor resolution. `onWorkerError` routes prewarm
  // failures through the consumer's error sink instead of swallowing them.
  const [client, setClient] = useState<TransformClient | null>(null);
  useEffect(() => {
    const reportWorkerError = (err: Error): void => {
      const replErr: ReplError = { kind: 'runtime', message: err.message, stack: err.stack ?? '' };
      setLastError(replErr);
      latestRef.current.onPreviewError?.(replErr);
    };
    const c = new TransformClient({
      ...(swcWasmUrl ? { swcWasmUrl } : {}),
      hmr,
      loader,
      virtualModules: virtualModulesRaw,
      onWorkerError: reportWorkerError,
    });
    void c.prewarm();
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

  // The live session, set inside the iframe ref callback below. The
  // file-sync effect reads from it to forward edits; the cold-boot path
  // runs once per attach.
  const sessionRef = useRef<TransformSession | null>(null);

  // Bumped to force a fresh iframe (and with it a fresh cold boot) when
  // there's no Refresh to apply an edit. Scoped here, not to the provider's
  // `reloadPreview`, so the client and its worker survive the turnover.
  const [iframeKey, setIframeKey] = useState(0);

  const srcdoc = useMemo(
    () =>
      importMap === null || client === null
        ? null
        : generatePreviewHtml({
            importMap,
            baseHref: props.baseHref,
            headHtml: props.headHtml,
            bodyHtml: props.bodyHtml,
            showErrorOverlay: showOverlay,
            hmr,
          }),
    [importMap, client, props.baseHref, props.headHtml, props.bodyHtml, showOverlay, hmr],
  );

  // React 19 callback ref with cleanup. Attaches listener + session
  // synchronously with the iframe mounting; the iframe can't post `ready`
  // before we're listening.
  //
  // `srcdoc` is in the dep list so head/body/overlay changes re-run this
  // callback (revoke old blob URL, detach session, then fresh setup). The
  // DOM element identity is preserved across the cycle — only this
  // callback's state turns over.
  const setupIframe = useCallback(
    (iframe: HTMLIFrameElement) => {
      // Defensive narrowing for TypeScript — the iframe only renders when
      // client + srcdoc are non-null (see srcdoc memo / JSX guard).
      if (!client || srcdoc === null) return;

      // Mint a fresh blob URL for this attach. Revoked in the cleanup
      // below — single-lifecycle ownership keeps this leak-free even
      // under React strict mode's mount/unmount/mount cycle.
      const blobUrl = URL.createObjectURL(new Blob([srcdoc], { type: 'text/html' }));
      iframe.src = blobUrl;

      // Forward the consumer's iframeRef. Read via latestRef so changes
      // don't tear down the session.
      const userRef = latestRef.current.iframeRef;
      let detachUserRef: (() => void) | undefined;
      if (userRef) {
        if (typeof userRef === 'function') {
          const ret = userRef(iframe);
          // React 19 callback refs may return a cleanup. Fall back to
          // calling with null on detach when they don't.
          detachUserRef = typeof ret === 'function' ? ret : () => userRef(null);
        } else {
          (userRef as React.MutableRefObject<HTMLIFrameElement | null>).current = iframe;
          detachUserRef = () => {
            (userRef as React.MutableRefObject<HTMLIFrameElement | null>).current = null;
          };
        }
      }

      iframeRegistry.setIframe(iframe);

      // Per-iframe boot state. Lives in this callback's closure.
      let disposed = false;
      let booted = false;
      let ready = false;
      const queue: ToIframe[] = [];
      const collected: ModulePayload[] = [];
      const collectedCss: { path: string; css: string }[] = [];

      const send = (msg: ToIframe) => {
        if (!ready) queue.push(msg);
        else iframe.contentWindow?.postMessage({ __repl: true, ...msg }, '*');
      };
      const flush = () => {
        const out = queue.splice(0);
        for (const m of out) iframe.contentWindow?.postMessage({ __repl: true, ...m }, '*');
      };

      const reportError = (err: ReplError) => {
        setLastError(err);
        latestRef.current.onPreviewError?.(err);
      };

      const session = client.attachSession(
        {
          onModule: (m) => {
            if (!booted) {
              collected.push(m);
            } else {
              send({ kind: 'load', module: m });
              // A successful module load implicitly clears prior transform
              // errors for that path; the iframe's overlay updates on the
              // next tick.
              send({ kind: 'clear-errors' });
            }
          },
          onCssUpsert: (path, css) => {
            if (!booted) collectedCss.push({ path, css });
            else send({ kind: 'css-upsert', path, css });
          },
          onCssRemove: (path) => send({ kind: 'css-remove', path }),
          onError: (e: TransformError) => {
            const err: ReplError =
              e.kind === 'resolve'
                ? { kind: 'resolve', path: e.path, specifier: e.specifier ?? '' }
                : {
                    kind: 'transform',
                    path: e.path,
                    message: e.message,
                    loc: e.loc,
                  };
            reportError(err);
            send(
              e.kind === 'resolve'
                ? { kind: 'resolve-error', path: e.path, specifier: e.specifier ?? '' }
                : {
                    kind: 'transform-error',
                    path: e.path,
                    message: e.message,
                    loc: e.loc,
                  },
            );
          },
        },
        // CDN resolution requires both halves: the resolver and the vendor
        // keys it classifies against (the type pairs them). `vendorKeys` is
        // non-null here — the iframe only mounts once the import map has
        // resolved (see the srcdoc memo / JSX guard) — so this is `undefined`
        // only when no resolver was configured.
        cdn && vendorKeys ? { cdn, vendorKeys } : undefined,
      );
      sessionRef.current = session;

      const onMessage = async (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.__repl !== true) return;
        // Security invariant: accept only this iframe's window, and only from
        // the preview document's own (opaque) origin — see `isFromPreview`.
        if (!isFromPreview(event, iframe.contentWindow)) return;
        const msg = data as FromIframe & { __repl: true };
        if (msg.kind === 'ready') {
          ready = true;
          try {
            await session.setFiles(latestRef.current.filesForEngine);
            if (disposed) return;
            booted = true;
            // Batch the cold-boot output into a single message — keeps the
            // dep graph already topo-ordered (the session emits in order)
            // and avoids interleaving with whatever the iframe queues up
            // for its first tick.
            iframe.contentWindow?.postMessage(
              {
                __repl: true,
                kind: 'boot',
                // The runtime entry is always the synthetic shell — never
                // the user-facing entry. The shell imports the latter and
                // is what `root.render(...)` mounts.
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
          latestRef.current.onMounted?.();
        } else if (msg.kind === 'runtime-error') {
          reportError({ kind: 'runtime', message: msg.message, stack: msg.stack });
        }
      };
      window.addEventListener('message', onMessage);

      return () => {
        disposed = true;
        window.removeEventListener('message', onMessage);
        session.detach();
        if (sessionRef.current === session) sessionRef.current = null;
        iframeRegistry.setIframe(null);
        detachUserRef?.();
        URL.revokeObjectURL(blobUrl);
      };
    },
    [client, srcdoc, iframeRegistry, setLastError, cdn, vendorKeys],
  );

  // Forward file changes into the live session. The initial value is *not*
  // forwarded here — the iframe's `ready` handler is the single cold-boot
  // trigger; firing setFiles() here would race it and defeat the batched
  // `boot` message. Pre-iframe-mount edits still fall through (no session
  // attached); the cold-boot path picks up the latest `filesForEngine` via
  // `latestRef` when `ready` arrives.
  const initialFilesRef = useRef(filesForEngine);
  useEffect(() => {
    if (filesForEngine === initialFilesRef.current) return;
    if (!hmr) {
      // Remounting re-runs the cold-boot path, which rebuilds the whole graph
      // from the latest files — the only correct update without Refresh. Keeps
      // the client (and its instantiated wasm) alive; only the iframe turns
      // over.
      setIframeKey((key) => key + 1);
      return;
    }
    void sessionRef.current?.setFiles(filesForEngine);
  }, [filesForEngine, hmr]);

  const sandbox = props.unsafeDropSandbox ? undefined : (props.sandbox ?? DEFAULT_SANDBOX);

  return (
    <div className={`repl-preview ${props.className ?? ''}`} style={props.style}>
      {srcdoc === null ? (
        // ImportMap still pending. Same-shape placeholder so layout doesn't
        // shift on iframe mount. A distinct class — `page.frameLocator
        // ('.repl-iframe')` would otherwise latch onto this during the
        // pending window and never resolve a real contentFrame.
        <div
          className="repl-iframe-placeholder"
          aria-busy="true"
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <iframe
          key={iframeKey}
          ref={setupIframe}
          className="repl-iframe"
          title="preview"
          sandbox={sandbox}
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
