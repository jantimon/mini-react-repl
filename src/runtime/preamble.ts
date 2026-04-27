/**
 * Runs before any other module. Installs the React Refresh hook on the
 * global object so that when `react` is imported by the main runtime
 * script, React's initialization sees the hook and wires up.
 *
 * This is shipped as a SEPARATE `<script type="module">` tag in the
 * iframe srcdoc, scheduled BEFORE the main runtime bundle. The browser
 * fully evaluates each module script in document order before starting
 * the next.
 *
 * @internal
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — types may not be published; runtime API is stable.
import * as RefreshRuntime from 'react-refresh/runtime';

RefreshRuntime.injectIntoGlobalHook(window);

// Default no-op stubs so user code that loads before the main runtime
// doesn't crash on a missing global. The main runtime overrides these
// for each module via the wrapper.
(window as unknown as { $RefreshReg$?: unknown; $RefreshSig$?: unknown }).$RefreshReg$ = () => {};
(window as unknown as { $RefreshReg$?: unknown; $RefreshSig$?: unknown }).$RefreshSig$ =
  () => (type: unknown) =>
    type;
