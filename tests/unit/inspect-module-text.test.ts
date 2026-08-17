import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getModuleRecord, type ModuleRecordLike } from '../../src/inspect/picker/module-text.ts';

// `vitest.config.ts` runs this suite under the `node` environment (no real
// `window`), and the project has no jsdom dependency — `getModuleRecord`
// only ever reads `window.__repl__.modules`, so a stubbed global covers it
// without pulling in a DOM implementation.
function setModules(modules: Map<string, ModuleRecordLike> | undefined): void {
  vi.stubGlobal('window', modules ? { __repl__: { modules } } : {});
}

describe('getModuleRecord', () => {
  // Default: runtime hasn't booted (`window` exists but has no `__repl__`).
  beforeEach(() => setModules(undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('returns undefined when the runtime has not booted', () => {
    expect(getModuleRecord('App.tsx')).toBeUndefined();
  });

  it('resolves by logical path directly (V8 / SpiderMonkey case)', () => {
    const rec: ModuleRecordLike = {
      path: 'App.tsx',
      compiledSource: 'x',
      blobUrl: 'blob:null/abc',
    };
    setModules(new Map([['App.tsx', rec]]));
    expect(getModuleRecord('App.tsx')).toBe(rec);
  });

  it('falls back to a blobUrl match when the direct path lookup misses (Safari case)', () => {
    const rec: ModuleRecordLike = {
      path: 'App.tsx',
      compiledSource: 'x',
      blobUrl: 'blob:null/abc-123',
    };
    setModules(new Map([['App.tsx', rec]]));
    // Safari reports the frame's fileName as the blob URL itself, not the
    // logical path — the fallback must still resolve to the same record.
    expect(getModuleRecord('blob:null/abc-123')).toBe(rec);
  });

  it('does not scan for non-blob paths that miss the direct lookup', () => {
    const rec: ModuleRecordLike = { path: 'App.tsx', compiledSource: 'x', blobUrl: null };
    setModules(new Map([['App.tsx', rec]]));
    expect(getModuleRecord('Missing.tsx')).toBeUndefined();
  });

  it('returns undefined for a blob URL with no matching record (genuine vendor/runtime blob)', () => {
    const rec: ModuleRecordLike = {
      path: 'App.tsx',
      compiledSource: 'x',
      blobUrl: 'blob:null/abc-123',
    };
    setModules(new Map([['App.tsx', rec]]));
    expect(getModuleRecord('blob:null/not-a-registered-module')).toBeUndefined();
  });

  it('picks the correct record when multiple modules are registered', () => {
    const app: ModuleRecordLike = { path: 'App.tsx', compiledSource: 'x', blobUrl: 'blob:null/1' };
    const card: ModuleRecordLike = {
      path: 'Card.tsx',
      compiledSource: 'y',
      blobUrl: 'blob:null/2',
    };
    setModules(
      new Map([
        ['App.tsx', app],
        ['Card.tsx', card],
      ]),
    );
    expect(getModuleRecord('blob:null/2')).toBe(card);
  });
});
