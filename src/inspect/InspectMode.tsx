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
   * Override classes for the hover overlay. The default styling (blue
   * border + tinted fill, fixed position, top-most z-index) is applied
   * unless this prop is set. Set to empty string to disable styling
   * entirely.
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
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(() => iframeRegistry.getIframe());

  // Subscribe to iframe lifecycle. The registry calls back synchronously on
  // subscribe with the current value, so we don't need a separate seed.
  useEffect(() => iframeRegistry.subscribe(setIframe), [iframeRegistry]);

  // Toggle the picker by posting to the iframe whenever `active` flips.
  // First activation also lazily injects the picker bundle into the iframe;
  // subsequent toggles are pure postMessage. The disable on cleanup also
  // fires on unmount and when the iframe element identity changes
  // (post-reloadPreview), so the picker never lingers.
  useEffect(() => {
    if (!active || !iframe) return undefined;

    const enable = () => {
      const target = iframe.contentWindow;
      if (!target) return false;
      if (!ensurePickerInstalled(iframe)) return false;
      target.postMessage(
        {
          __repl: true,
          kind: 'inspect:enable',
          ...(overlayClassName !== undefined ? { overlayClassName } : {}),
        },
        '*',
      );
      return true;
    };

    let onLoad: (() => void) | undefined;
    if (!enable()) {
      // Iframe document not ready yet — wait for its `load` event and try
      // again. Common case is the user pressing Inspect immediately after
      // mount; very fast iframes have already loaded by then.
      onLoad = () => {
        enable();
      };
      iframe.addEventListener('load', onLoad, { once: true });
    }

    return () => {
      if (onLoad) iframe.removeEventListener('load', onLoad);
      iframe.contentWindow?.postMessage({ __repl: true, kind: 'inspect:disable' }, '*');
    };
  }, [active, iframe, overlayClassName]);

  // Listen for picks and cancels from the iframe. Filtered by `event.source`
  // so a stale message from a previous iframe (post-reloadPreview) can't
  // sneak in after the new one boots.
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

export default InspectMode;
