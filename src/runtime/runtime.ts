/**
 * Iframe runtime. Loaded once per iframe mount as an inline ESM module
 * inside `preview.html` (srcdoc). Owns:
 *
 *   - the logical-path module registry (`window.__repl__.modules`)
 *   - React Refresh wiring
 *   - the entry-mounting loop
 *   - global error capture
 *   - postMessage protocol with the parent
 *
 * Imports of `react`, `react-dom/client`, `react-refresh/runtime` are
 * resolved through the iframe's import map (set up by `preview-html.ts`).
 *
 * @internal
 */

// React must be imported AFTER the preamble has run (which lives in a
// separate script tag and installed the Refresh hook). All bare imports
// here resolve via the iframe's import map at runtime.
import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — types may not be published; runtime API is stable.
import * as RefreshRuntime from 'react-refresh/runtime';

import type { ToIframe, FromIframe, ModulePayload } from './protocol.ts';
import { showOverlay, hideOverlay, setOverlayEnabled, type OverlayError } from './overlay.ts';

declare global {
  interface Window {
    /** Used by transformed user code; do not touch directly. */
    __repl__: ReplRuntime;
    /** Set/cleared by the per-module wrapper; not for user code. */
    $RefreshReg$?: (type: unknown, id: string) => void;
    $RefreshSig$?: () => (
      type: unknown,
      key: string,
      forceReset?: boolean,
      getCustomHooks?: () => unknown[],
    ) => unknown;
  }
}

type ModuleRecord = {
  path: string;
  /** Current blob URL — replaced on each reload. Old URL is revoked. */
  blobUrl: string | null;
  /** Whether this module has finished evaluating at least once. */
  evaluated: boolean;
};

type ReplRuntime = {
  modules: Map<string, ModuleRecord>;
  refresh: {
    register: (path: string, type: unknown, id: string) => void;
    createSignature: () => (
      type: unknown,
      key: string,
      forceReset?: boolean,
      getCustomHooks?: () => unknown[],
    ) => unknown;
  };
  commit: (path: string) => void;
};

// ─────────────────────────────────────────────────────────────────────
// Refresh runtime — the global hook was already injected by preamble.ts
// (a separate `<script type="module">` that ran before this one). We
// only schedule refreshes here.
// ─────────────────────────────────────────────────────────────────────

let refreshScheduled = false;
function scheduleRefresh(): void {
  if (refreshScheduled) return;
  refreshScheduled = true;
  queueMicrotask(() => {
    refreshScheduled = false;
    try {
      RefreshRuntime.performReactRefresh();
    } catch (err) {
      // refresh itself failing is unrecoverable; surface and reset
      const message = err instanceof Error ? err.message : String(err);
      reportRuntimeError({
        kind: 'runtime',
        message: `React Refresh failed: ${message}`,
        stack: err instanceof Error ? (err.stack ?? '') : '',
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Module registry
// ─────────────────────────────────────────────────────────────────────

const modules = new Map<string, ModuleRecord>();

function ensureRecord(path: string): ModuleRecord {
  let rec = modules.get(path);
  if (!rec) {
    rec = { path, blobUrl: null, evaluated: false };
    modules.set(path, rec);
  }
  return rec;
}

const replRuntime: ReplRuntime = {
  modules,
  refresh: {
    register(path, type, id) {
      // path-prefixed ID prevents collisions between same-named exports
      // across different files.
      RefreshRuntime.register(type, `${path} ${id}`);
    },
    createSignature() {
      return RefreshRuntime.createSignatureFunctionForTransform();
    },
  },
  commit(path) {
    const rec = ensureRecord(path);
    rec.evaluated = true;
    scheduleRefresh();
  },
};

window.__repl__ = replRuntime;

// ─────────────────────────────────────────────────────────────────────
// Entry mounting
// ─────────────────────────────────────────────────────────────────────

let root: ReactDOMClient.Root | null = null;
let entryPath: string | null = null;

/**
 * Build the wrapped, import-rewritten module body and turn it into a
 * blob URL inside this iframe's context. Parent-created blob URLs do
 * not load reliably under srcdoc — we keep the whole blob registry on
 * this side.
 */
function buildBlobUrl(payload: ModulePayload): string {
  let code = payload.code;
  // Replace each dep specifier with the current blob URL of the target
  // module. The specifier comes from the parent's es-module-lexer pass
  // and is guaranteed to appear as a literal substring in `code`.
  for (const dep of payload.deps) {
    const targetRec = modules.get(dep.target);
    const targetUrl = targetRec?.blobUrl;
    if (!targetUrl) continue;
    code = code.split(`'${dep.specifier}'`).join(`'${targetUrl}'`);
    code = code.split(`"${dep.specifier}"`).join(`"${targetUrl}"`);
  }
  const wrapped = wrapModuleBody(payload.path, code);
  return URL.createObjectURL(new Blob([wrapped], { type: 'text/javascript' }));
}

function wrapModuleBody(path: string, body: string): string {
  const safe = JSON.stringify(path);
  return [
    `const __repl__ = window.__repl__;`,
    `const __prevReg = window.$RefreshReg$;`,
    `const __prevSig = window.$RefreshSig$;`,
    `window.$RefreshReg$ = (type, id) => __repl__.refresh.register(${safe}, type, id);`,
    `window.$RefreshSig$ = () => __repl__.refresh.createSignature();`,
    body,
    // restore previous reg/sig (best-effort; ESM modules execute once so
    // this is mostly defensive in case nested code reads them).
    `window.$RefreshReg$ = __prevReg;`,
    `window.$RefreshSig$ = __prevSig;`,
    `__repl__.commit(${safe});`,
  ].join('\n');
}

async function mountEntry(blobUrl: string, path: string): Promise<void> {
  entryPath = path;
  try {
    // Fresh import — the path-keyed registry handles identity, the blob
    // URL itself is just the executable carrier.
    const mod = await import(/* @vite-ignore */ blobUrl);
    const Component = mod.default;
    if (typeof Component !== 'function') {
      throw new Error(
        `Entry module '${path}' must export a default React component (got ${typeof Component}).`,
      );
    }
    const container = document.getElementById('root');
    if (!container) {
      throw new Error('No #root element in iframe document.');
    }
    if (!root) {
      root = ReactDOMClient.createRoot(container);
    }
    root.render(React.createElement(Component));
    hideOverlay();
    postToParent({ kind: 'mounted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    reportRuntimeError({ kind: 'runtime', message, stack });
  }
}

async function loadModule(payload: ModulePayload): Promise<void> {
  // Build a fresh blob URL inside this iframe (parent-created URLs don't
  // load under srcdoc). Refresh's path-keyed registry is what gives us
  // stable module identity across edits, not the URL.
  const rec = ensureRecord(payload.path);
  const prevUrl = rec.blobUrl;
  const newUrl = buildBlobUrl(payload);
  rec.blobUrl = newUrl;

  try {
    await import(/* @vite-ignore */ newUrl);
    if (payload.path === entryPath && !root) {
      await mountEntry(newUrl, payload.path);
    }
    // Revoke the previous URL only after the new one has been imported
    // successfully. The browser's module loader caches by URL, so already-
    // resolved imports against the old URL keep working — but new imports
    // would 404, which is exactly what we want for a freshly-edited file.
    if (prevUrl && prevUrl !== newUrl) URL.revokeObjectURL(prevUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    reportRuntimeError({ kind: 'runtime', message, stack });
  }
}

// ─────────────────────────────────────────────────────────────────────
// CSS handling
// ─────────────────────────────────────────────────────────────────────

const cssTags = new Map<string, HTMLStyleElement>();

function upsertCss(path: string, css: string): void {
  let tag = cssTags.get(path);
  if (!tag) {
    tag = document.createElement('style');
    tag.setAttribute('data-repl-css', path);
    insertInAlphabeticalOrder(tag, path);
    cssTags.set(path, tag);
  }
  if (tag.textContent !== css) tag.textContent = css;
}

function removeCss(path: string): void {
  const tag = cssTags.get(path);
  if (tag) {
    tag.remove();
    cssTags.delete(path);
  }
}

function insertInAlphabeticalOrder(tag: HTMLStyleElement, path: string): void {
  const head = document.head;
  const existing = Array.from(head.querySelectorAll<HTMLStyleElement>('style[data-repl-css]'));
  const before = existing.find((el) => (el.getAttribute('data-repl-css') ?? '') > path);
  if (before) {
    head.insertBefore(tag, before);
  } else {
    head.appendChild(tag);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Error capture
// ─────────────────────────────────────────────────────────────────────

window.addEventListener('error', (event) => {
  reportRuntimeError({
    kind: 'runtime',
    message: event.error instanceof Error ? event.error.message : event.message,
    stack: event.error instanceof Error ? (event.error.stack ?? '') : '',
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const err = event.reason;
  reportRuntimeError({
    kind: 'runtime',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? (err.stack ?? '') : '',
  });
});

function reportRuntimeError(err: OverlayError): void {
  showOverlay(err);
  if (err.kind === 'runtime') {
    postToParent({
      kind: 'runtime-error',
      message: err.message,
      stack: err.stack,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// PostMessage wiring
// ─────────────────────────────────────────────────────────────────────

function postToParent(msg: FromIframe): void {
  parent.postMessage({ __repl: true, ...msg }, '*');
}

window.addEventListener('message', async (event: MessageEvent) => {
  const data = event.data;
  if (!data || data.__repl !== true) return;
  const msg = data as ToIframe & { __repl: true };

  switch (msg.kind) {
    case 'boot': {
      for (const css of msg.cssFiles) upsertCss(css.path, css.css);
      entryPath = msg.entry;
      // Build blob URLs in the order the parent sent (already topo-sorted
      // there) so each module's deps already have URLs by the time we
      // build that module's blob.
      for (const payload of msg.modules) {
        const rec = ensureRecord(payload.path);
        rec.blobUrl = buildBlobUrl(payload);
      }
      // Now import them in the same order. Each `await import(blobUrl)`
      // executes the module body, which references prior modules' URLs.
      for (const payload of msg.modules) {
        const rec = modules.get(payload.path);
        if (!rec?.blobUrl) continue;
        try {
          await import(/* @vite-ignore */ rec.blobUrl);
        } catch (err) {
          reportRuntimeError({
            kind: 'runtime',
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? (err.stack ?? '') : '',
          });
          return;
        }
      }
      const entryRec = modules.get(msg.entry);
      if (entryRec?.blobUrl) await mountEntry(entryRec.blobUrl, msg.entry);
      break;
    }
    case 'load': {
      void loadModule(msg.module);
      break;
    }
    case 'unload': {
      modules.delete(msg.path);
      break;
    }
    case 'css-upsert': {
      upsertCss(msg.path, msg.css);
      break;
    }
    case 'css-remove': {
      removeCss(msg.path);
      break;
    }
    case 'transform-error': {
      showOverlay({
        kind: 'transform',
        path: msg.path,
        message: msg.message,
        ...(msg.loc ? { loc: msg.loc } : {}),
      });
      break;
    }
    case 'resolve-error': {
      showOverlay({ kind: 'resolve', path: msg.path, specifier: msg.specifier });
      break;
    }
    case 'clear-errors': {
      hideOverlay();
      break;
    }
    case 'reset': {
      if (root) {
        root.unmount();
        root = null;
      }
      modules.clear();
      cssTags.forEach((t) => t.remove());
      cssTags.clear();
      hideOverlay();
      entryPath = null;
      break;
    }
  }
});

// ─────────────────────────────────────────────────────────────────────
// Overlay enable/disable bridge
// ─────────────────────────────────────────────────────────────────────

// The parent flips this via a custom data attribute set on the iframe element
// before sending boot. Polled once at startup; if the parent wants to flip
// it later, it should send `clear-errors` and the next error will reappear.
const overlayAttr = (window.frameElement as HTMLIFrameElement | null)?.dataset?.['overlay'];
if (overlayAttr === 'off') setOverlayEnabled(false);

postToParent({ kind: 'ready' });
