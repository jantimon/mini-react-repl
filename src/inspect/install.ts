/**
 * Lazy injection of the in-iframe picker.
 *
 * The picker bundle is shipped as part of the optional `mini-react-repl/inspect`
 * subpath. Consumers who never import this subpath never pay the iframe-side
 * cost; consumers who do, pay it on first activation of `<InspectMode/>` —
 * one DOM mutation per iframe document, then the picker stays installed for
 * the iframe's lifetime.
 *
 * @internal
 */

import { INSPECT_PICKER_CODE } from './picker.bundled.ts';

const installed = new WeakSet<Window>();

/**
 * Inject the picker script into `iframe`'s document if not already present.
 * Returns `true` once the picker is active in that iframe (newly injected
 * or already there from a prior call), `false` if the iframe document
 * isn't ready yet (caller should retry on the iframe's `load` event).
 *
 * Tracking is keyed by the iframe's `Window` object — when the srcdoc
 * reloads, `contentWindow` is a fresh object, so the next call re-injects
 * automatically.
 */
export function ensurePickerInstalled(iframe: HTMLIFrameElement): boolean {
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) return false;
  if (installed.has(win)) return true;
  const head = doc.head;
  if (!head) return false;
  const script = doc.createElement('script');
  // Plain (classic) script with inline text content. Per HTML spec,
  // appending it to a document evaluates the script synchronously, so by
  // the time `appendChild` returns the picker has registered its message
  // listener and is ready to receive `inspect:enable`.
  script.setAttribute('data-repl-inspect-picker', '');
  script.textContent = INSPECT_PICKER_CODE;
  head.appendChild(script);
  installed.add(win);
  return true;
}
