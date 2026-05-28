/**
 * Host-side guard for `__repl` envelopes arriving from the preview iframe.
 *
 * `event.source === expectedSource` alone is not enough. User code inside the
 * sandboxed preview can run `location.href = 'https://attacker.example'`,
 * which navigates the iframe *in place* — `allow-top-navigation` does not gate
 * a frame navigating itself. The host's `iframe.contentWindow` reference then
 * resolves to the attacker document, so the source check still passes and the
 * external origin would inherit the host's trusted `__repl` channel (driving
 * `onPreviewError`, `onElementPicked`, the picker install ack, …).
 *
 * Pinning the origin closes that path. Accepted origins:
 *   - `'null'` — the sandboxed (opaque-origin) preview document, the default.
 *     A `data:`/`blob:` URL the user navigates to is also opaque, but that is
 *     still user-authored client code with no more reach than the original
 *     document — not an escalation.
 *   - `location.origin` — when the consumer drops the sandbox
 *     (`unsafeDropSandbox`) or adds `allow-same-origin`, the preview is
 *     same-origin with the host.
 *
 * A real external origin (the navigation attack) matches neither and is
 * rejected.
 *
 * @internal
 */
export function isFromPreview(
  event: MessageEvent,
  expectedSource: Window | null | undefined,
): boolean {
  if (!expectedSource || event.source !== expectedSource) return false;
  return event.origin === 'null' || event.origin === location.origin;
}
