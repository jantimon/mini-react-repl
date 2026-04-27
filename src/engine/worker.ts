/// <reference lib="webworker" />

/**
 * Transform worker. Runs swc-wasm-web off the main thread; receives source
 * over postMessage, returns transformed JS + inline source maps.
 *
 * Loaded by the main thread via:
 *   `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`
 *
 * @internal
 */

import initSwc, { transform } from '@swc/wasm-web';

type InitMessage = {
  kind: 'init';
  id: number;
  /**
   * URL to the swc-wasm binary. Defaults to a CDN; consumers can override
   * via `<Repl swcWasmUrl="/swc.wasm" />`.
   */
  wasmUrl: string;
};

type TransformMessage = {
  kind: 'transform';
  id: number;
  path: string;
  source: string;
};

type IncomingMessage = InitMessage | TransformMessage;

let initialized: Promise<void> | null = null;

async function ensureInit(wasmUrl: string): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      await initSwc({ module_or_path: wasmUrl });
    })();
  }
  return initialized;
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  if (msg.kind === 'init') {
    try {
      await ensureInit(msg.wasmUrl);
      self.postMessage({ kind: 'init-ok', id: msg.id });
    } catch (err) {
      self.postMessage({
        kind: 'init-err',
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.kind === 'transform') {
    if (!initialized) {
      self.postMessage({
        kind: 'transform-err',
        id: msg.id,
        path: msg.path,
        message: 'worker not initialized; call init first',
      });
      return;
    }
    try {
      await initialized;
      const isTsx = msg.path.endsWith('.tsx') || msg.path.endsWith('.jsx');
      const result = await transform(msg.source, {
        filename: msg.path,
        sourceMaps: 'inline',
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: isTsx,
            decorators: false,
            dynamicImport: true,
          },
          target: 'es2022',
          transform: {
            react: {
              runtime: 'automatic',
              development: true,
              refresh: true,
            },
          },
        },
        module: {
          type: 'es6',
        },
      });
      self.postMessage({
        kind: 'transform-ok',
        id: msg.id,
        path: msg.path,
        code: result.code,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const loc = parseSwcLocation(message);
      self.postMessage({
        kind: 'transform-err',
        id: msg.id,
        path: msg.path,
        message,
        loc,
      });
    }
  }
};

/**
 * Best-effort extraction of `line:column` from swc's diagnostic strings,
 * which look like:
 *
 *     × Expression expected
 *      ╭─[App.tsx:5:3]
 *
 * If we can't find one, the caller falls back to no location.
 */
function parseSwcLocation(message: string): { line: number; column: number } | undefined {
  const match = /:(\d+):(\d+)\]/.exec(message);
  if (!match) return undefined;
  return { line: Number(match[1]), column: Number(match[2]) };
}

// signal we're alive; main thread waits for this before sending `init`
self.postMessage({ kind: 'worker-loaded' });
