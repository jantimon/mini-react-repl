/**
 * Lazy install of the in-iframe picker via postMessage.
 *
 * The picker bundle ships as part of the optional `mini-react-repl/inspect`
 * subpath. Consumers who never import this subpath never pay the iframe-side
 * cost; consumers who do, pay it on first activation of `<InspectMode/>`.
 *
 * The host posts `{ kind: 'inspect:install', code }` carrying the picker's
 * ESM source. The iframe runtime turns it into a blob URL and `import()`s it
 * — so the picker rides the same cross-origin channel that user modules
 * already use. No `iframe.contentDocument` access required; this works under
 * `sandbox="allow-scripts"`.
 *
 * @internal
 */

import { INSPECT_PICKER_CODE } from './picker.bundled.ts';

const INSTALL_TIMEOUT_MS = 5_000;

// Keyed by the iframe's `Window` object — when the srcdoc reloads,
// `contentWindow` is a fresh object, so the next call re-installs
// automatically. Memoized as Promise to dedup concurrent calls.
const installed = new WeakMap<Window, Promise<boolean>>();

/**
 * Ensure the picker bundle is installed inside `iframe`. Returns a promise
 * that resolves `true` once the runtime has acknowledged the install (and
 * therefore the picker's message listener is live), `false` on timeout or
 * if the iframe has no contentWindow.
 *
 * Safe to call repeatedly: the second call resolves immediately via the
 * memoized promise.
 */
export function ensurePickerInstalled(iframe: HTMLIFrameElement): Promise<boolean> {
  const win = iframe.contentWindow;
  if (!win) return Promise.resolve(false);
  const cached = installed.get(win);
  if (cached) return cached;

  const promise = new Promise<boolean>((resolve) => {
    const onAck = (event: MessageEvent) => {
      if (event.source !== win) return;
      const data = event.data as { __repl?: unknown; kind?: unknown } | null;
      if (!data || data.__repl !== true || data.kind !== 'inspect:installed') return;
      cleanup();
      resolve(true);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      // Drop the cached promise so a later call can retry. Without this a
      // transient install failure would lock the picker out for the iframe's
      // lifetime.
      installed.delete(win);
      resolve(false);
    }, INSTALL_TIMEOUT_MS);
    function cleanup(): void {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onAck);
    }
    window.addEventListener('message', onAck);
    win.postMessage(
      { __repl: true, kind: 'inspect:install', code: INSPECT_PICKER_CODE },
      '*',
    );
  });

  installed.set(win, promise);
  return promise;
}
