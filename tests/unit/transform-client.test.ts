import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  TransformSession,
  type TransformClient,
  type SessionHandlers,
  type TransformError,
  type ModulePayload,
} from '../../src/engine/transform-client.ts';
import { initLexer } from '../../src/engine/import-rewriter.ts';
import { isCodeFile, isCssFile } from '../../src/engine/path-utils.ts';
import type { ReplCdnResolver, ReplLoader } from '../../src/types.ts';

// The real client owns a browser `Worker`, which can't boot in the node test
// env. Stub the surface `TransformSession` actually touches: a loader that
// treats the source as already-compiled JS (skipping the worker round-trip),
// plus the no-op lifecycle hooks. Zero debounce keeps scheduled transforms
// near-synchronous so `vi.waitFor` resolves quickly.
function fakeClient(): TransformClient {
  const loader: ReplLoader = ({ path, source }) => {
    if (isCssFile(path)) return { kind: 'css', source };
    if (!isCodeFile(path)) return null; // e.g. package.json — emits no module
    return { kind: 'module', code: source };
  };
  return {
    opts: { loader, debounceMs: 0 },
    virtualSources: {},
    virtualAliases: new Set<string>(),
    ensureWorker: async () => {},
    runTransform: async () => {
      throw new Error('runTransform should not be reached: the stub loader skips it');
    },
    isDisposed: () => false,
    releaseSession: () => {},
  } as unknown as TransformClient;
}

function collectHandlers() {
  const modules: ModulePayload[] = [];
  const errors: TransformError[] = [];
  const handlers: SessionHandlers = {
    onModule: (m) => modules.push(m),
    onCssUpsert: () => {},
    onCssRemove: () => {},
    onError: (e) => errors.push(e),
  };
  return { handlers, modules, errors };
}

// A resolver that records the `declaredVersions` it's handed on each call.
function makeCdn() {
  const calls: { specifier: string; declared?: Record<string, string> }[] = [];
  const cdn: ReplCdnResolver = (specifier, _shared, _from, declared) => {
    calls.push({ specifier, declared });
    return `https://cdn.test/${specifier}`;
  };
  return { cdn, calls };
}

const VENDOR_KEYS = new Set(['react']);
const APP_IMPORTS_CDN = `import c from 'canvas-confetti'\n`;

describe('TransformSession bare-specifier resolution', () => {
  beforeAll(async () => {
    await initLexer();
  });

  it('forwards a REPL package.json dependency pins to the resolver', async () => {
    const { cdn, calls } = makeCdn();
    const { handlers } = collectHandlers();
    const session = new TransformSession(fakeClient(), handlers, { cdn, vendorKeys: VENDOR_KEYS });

    await session.setFiles({
      'App.tsx': APP_IMPORTS_CDN,
      'package.json': JSON.stringify({ dependencies: { 'canvas-confetti': '1.9.3' } }),
    });

    expect(calls).toContainEqual({
      specifier: 'canvas-confetti',
      declared: { 'canvas-confetti': '1.9.3' },
    });
  });

  it('hands the resolver undefined declaredVersions when there is no package.json', async () => {
    const { cdn, calls } = makeCdn();
    const { handlers } = collectHandlers();
    const session = new TransformSession(fakeClient(), handlers, { cdn, vendorKeys: VENDOR_KEYS });

    await session.setFiles({ 'App.tsx': APP_IMPORTS_CDN });

    expect(calls).toEqual([{ specifier: 'canvas-confetti', declared: undefined }]);
  });

  it('re-resolves every module when package.json changes, even if no module source did', async () => {
    const { cdn, calls } = makeCdn();
    const { handlers } = collectHandlers();
    const session = new TransformSession(fakeClient(), handlers, { cdn, vendorKeys: VENDOR_KEYS });

    await session.setFiles({
      'App.tsx': APP_IMPORTS_CDN,
      'package.json': JSON.stringify({ dependencies: { 'canvas-confetti': '1.0.0' } }),
    });
    calls.length = 0;

    // Only the manifest changes; App.tsx is byte-for-byte identical. Because a
    // resolver is active, the session must still re-transform App.tsx so the
    // new pin is baked into its CDN URL.
    await session.setFiles({
      'App.tsx': APP_IMPORTS_CDN,
      'package.json': JSON.stringify({ dependencies: { 'canvas-confetti': '2.0.0' } }),
    });

    await vi.waitFor(() => {
      expect(calls.some((c) => c.declared?.['canvas-confetti'] === '2.0.0')).toBe(true);
    });
  });

  it('does NOT re-resolve unrelated modules on a package.json edit when no resolver is configured', async () => {
    const { handlers, modules } = collectHandlers();
    const session = new TransformSession(fakeClient(), handlers, undefined);

    await session.setFiles({
      'App.tsx': APP_IMPORTS_CDN,
      'package.json': JSON.stringify({ dependencies: { 'canvas-confetti': '1.0.0' } }),
    });
    modules.length = 0;

    await session.setFiles({
      'App.tsx': APP_IMPORTS_CDN,
      'package.json': JSON.stringify({ dependencies: { 'canvas-confetti': '2.0.0' } }),
    });
    // Give any (incorrectly) scheduled transform a chance to fire.
    await new Promise((r) => setTimeout(r, 20));

    expect(modules.some((m) => m.path === 'App.tsx')).toBe(false);
  });
});
