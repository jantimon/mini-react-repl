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

import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { ReplActionsContext, ReplStateContext } from './context.ts';
import { generatePreviewHtml } from '../preview-html.ts';
import {
  TransformClient,
  type ModulePayload,
  type TransformError,
} from '../engine/transform-client.ts';
import type { ToIframe, FromIframe } from '../runtime/protocol.ts';
import type { ReplError } from '../types.ts';

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
  className?: string;
  style?: React.CSSProperties;
};

export function ReplPreview(props: ReplPreviewProps): React.ReactElement {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) throw new Error('<ReplPreview/> must be inside <ReplProvider/>');

  const filesRef = useRef(state.files);
  filesRef.current = state.files;

  const showOverlay = props.showPreviewErrorOverlay !== false;
  const onErrorRef = useRef(props.onPreviewError);
  onErrorRef.current = props.onPreviewError;
  const onMountedRef = useRef(props.onMounted);
  onMountedRef.current = props.onMounted;
  // Stash the consumer's iframeRef so its identity changes don't churn the
  // heavy iframe lifecycle below. Forwarding happens inside `setupIframe`
  // so consumers see the iframe attached at ref-phase timing (before the
  // first useLayoutEffect), matching the contract of a normal forwarded ref.
  const iframeRefBox = useRef(props.iframeRef);
  iframeRefBox.current = props.iframeRef;

  // The TransformClient is created inside the iframe-lifecycle ref callback
  // and shared with the file-sync effect via this ref. The setLastError
  // closure is captured here once — `actions` is stable for the provider's
  // lifetime, so this cap doesn't churn.
  const clientRef = useRef<TransformClient | null>(null);

  // Memoize srcdoc so file edits don't recompute / remount the iframe.
  // `actions.vendor` is snapshotted on first ReplProvider mount, so its
  // identity is stable; props.headHtml / props.bodyHtml are still consumer-
  // owned and trigger a remount on change as documented.
  const srcdoc = useMemo(
    () =>
      generatePreviewHtml({
        vendor: actions.vendor,
        ...(props.headHtml !== undefined ? { headHtml: props.headHtml } : {}),
        ...(props.bodyHtml !== undefined ? { bodyHtml: props.bodyHtml } : {}),
        showErrorOverlay: showOverlay,
      }),
    [actions.vendor, props.headHtml, props.bodyHtml, showOverlay],
  );

  const setLastError = actions.setLastError;
  const entry = actions.entry;
  const swcWasmUrl = actions.swcWasmUrl;
  const loader = actions.loader;

  // React 19 callback ref with cleanup. When `srcdoc` (or any dep) changes,
  // React fires the previous ref's cleanup (disposes the client + listener)
  // and re-invokes this callback with the same iframe element. No `key`
  // needed; the dep change drives the lifecycle.
  const setupIframe = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      // Forward to the consumer's iframeRef. Read via the ref box so this
      // callback's deps don't include `props.iframeRef` (which would tear
      // down + re-create the transform client on every consumer render
      // when an inline callback ref is used).
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

      if (!iframe) return detachUserRef;

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

      const client = new TransformClient({
        ...(swcWasmUrl ? { swcWasmUrl } : {}),
        ...(loader ? { loader } : {}),
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
      clientRef.current = client;

      const onMessage = async (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.__repl !== true) return;
        if (event.source !== iframe.contentWindow) return;
        const msg = data as FromIframe & { __repl: true };
        if (msg.kind === 'ready') {
          ready = true;
          // cold boot: transform everything and send one boot message.
          try {
            // record current files without scheduling per-file transforms;
            // transformAll() does the work in topological order.
            client.setFiles(filesRef.current);
            await client.transformAll();
            if (disposed) return;
            booted = true;
            iframe.contentWindow?.postMessage(
              {
                __repl: true,
                kind: 'boot',
                entry,
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
        client.dispose();
        if (clientRef.current === client) clientRef.current = null;
        detachUserRef?.();
      };
    },
    [srcdoc, entry, swcWasmUrl, loader, setLastError],
  );

  // Forward file changes into the live transform client. Waits until the
  // boot message has flushed so we don't double-process the cold set.
  useEffect(() => {
    clientRef.current?.syncFiles(state.files);
  }, [state.files]);

  return (
    <div className={`repl-preview ${props.className ?? ''}`} style={props.style}>
      <iframe ref={setupIframe} className="repl-iframe" srcDoc={srcdoc} title="preview" />
    </div>
  );
}
