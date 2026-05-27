/**
 * `<InspectMode/>` — toggle the in-iframe element picker from the host.
 *
 * Renders nothing. Place it as a sibling of `<ReplPreview/>` inside the
 * surrounding `<ReplProvider/>`; it discovers the live iframe through the
 * provider's iframe registry and posts `inspect:enable` / `inspect:disable`
 * envelopes (`{ __repl: true, kind: ... }`) to the iframe runtime.
 *
 * @public
 */

import { useContext, useEffect, useState } from 'react';
import { ReplActionsContext } from '../components/context.ts';
import { ensurePickerInstalled } from './install.ts';
import type { ElementPick } from './types.ts';

export type InspectModeProps = {
  /**
   * When `true`, install hover overlay + click handler in the preview
   * iframe. When `false`, all listeners and overlay state are removed.
   * Toggling is cheap and reversible.
   */
  active: boolean;
  /** Fires once per click on a fiber-bearing element. */
  onElementPicked: (pick: ElementPick) => void;
  /**
   * Fires when the user presses Escape while picking. Use this to drive
   * one-shot UX (auto-disable inspect mode after a pick / cancel).
   */
  onCancel?: () => void;
  /**
   * Override class for the hover overlay. The default styling (blue tinted
   * shadow, fixed position, top layer) is applied unless this prop is set.
   * Pass an empty string to disable styling entirely.
   */
  overlayClassName?: string;
};

/**
 * Drive the in-iframe element picker from the React side. Renders nothing.
 *
 * @example
 * ```tsx
 * <ReplProvider files={files} onFilesChange={setFiles} vendor={vendor}>
 *   <ReplPreview />
 *   <InspectMode
 *     active={inspecting}
 *     onElementPicked={(pick) => {
 *       setInspecting(false);
 *       console.log(pick.stack[0]);
 *     }}
 *     onCancel={() => setInspecting(false)}
 *   />
 * </ReplProvider>
 * ```
 */
export function InspectMode(props: InspectModeProps): React.ReactElement | null {
  const actions = useContext(ReplActionsContext);
  if (!actions) {
    throw new Error('<InspectMode/> must be rendered inside <ReplProvider/>');
  }

  const { iframeRegistry } = actions;
  const { active, onElementPicked, onCancel, overlayClassName } = props;
  // The registry's `subscribe` fires synchronously with the current value,
  // so we don't need a useState seed beyond `null` — but seeding from
  // `getIframe()` lets the first render skip the no-iframe branch when the
  // preview is already mounted.
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(() => iframeRegistry.getIframe());
  useEffect(() => iframeRegistry.subscribe(setIframe), [iframeRegistry]);

  // Toggle the picker via postMessage when `active` flips. First activation
  // also runs `ensurePickerInstalled` (the runtime dynamic-imports the
  // picker bundle from a blob URL); subsequent toggles are pure enable/
  // disable posts. `AbortController` cancels the install promise if the
  // effect tears down (active flipped off, iframe re-mounted) before the
  // picker has acknowledged.
  useEffect(() => {
    if (!active || !iframe) return undefined;
    const controller = new AbortController();

    ensurePickerInstalled(iframe).then((ok) => {
      if (controller.signal.aborted || !ok) return;
      iframe.contentWindow?.postMessage(
        {
          __repl: true,
          kind: 'inspect:enable',
          ...(overlayClassName !== undefined ? { overlayClassName } : {}),
        },
        '*',
      );
    });

    return () => {
      controller.abort();
      iframe.contentWindow?.postMessage({ __repl: true, kind: 'inspect:disable' }, '*');
    };
  }, [active, iframe, overlayClassName]);

  // Pick / cancel messages from the iframe. The `event.source` check stops
  // a stale message from a pre-reload iframe from leaking into a newer
  // session.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { __repl?: unknown; kind?: unknown; pick?: ElementPick } | null;
      if (!data || data.__repl !== true) return;
      if (iframe && event.source !== iframe.contentWindow) return;
      if (data.kind === 'inspect:pick' && data.pick) onElementPicked(data.pick);
      else if (data.kind === 'inspect:cancel') onCancel?.();
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [iframe, onElementPicked, onCancel]);

  return null;
}

// Default export pairs with the named one for lazy imports e.g.:
// `React.lazy(() => import('mini-react-repl/inspect'))`
export default InspectMode;
