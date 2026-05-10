import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearTraceMapCache,
  getTraceMap,
  invalidateTraceMap,
  lookupSourcePosition,
} from '../../src/inspect/picker/source-map.ts';
import type { ModuleRecordLike } from '../../src/inspect/picker/module-text.ts';
import { wrapModuleBody } from '../../src/runtime/module-wrapper.ts';

function inlineMap(map: object): string {
  const json = JSON.stringify(map);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return '//# sourceMappingURL=data:application/json;base64,' + btoa(bin);
}

/**
 * Build a one-mapping source map: compiled `(line, col)` ↔ source `(0, 0)` of
 * `sources[0]`. The VLQ for [0,0,0,0] (col=0, source=0, srcLine=0, srcCol=0)
 * is `AAAA`, padded with semicolons to the requested compiled line.
 */
function singleMappingMap(sourceName: string, compiledLine: number): object {
  const leadingSemicolons = ';'.repeat(compiledLine - 1); // line is 1-based
  return {
    version: 3,
    sources: [sourceName],
    sourcesContent: [null],
    mappings: leadingSemicolons + 'AAAA',
    names: [],
  };
}

describe('source-map lookup', () => {
  beforeEach(() => clearTraceMapCache());

  it('decodes a real wrapped module and lands on (1, 1)', () => {
    // wrapModuleBody prepends a 1-line prologue and shifts the inline map so
    // compiled line 2 (the user code's first line) maps back to line 1 in the
    // source. This tests the full mini-react-repl ↔ trace-mapping handshake.
    const userBody = `console.log(1);\n${inlineMap(singleMappingMap('App.tsx', 1))}`;
    const compiled = wrapModuleBody('App.tsx', userBody);
    const rec: ModuleRecordLike = { path: 'App.tsx', compiledSource: compiled };
    const result = lookupSourcePosition('App.tsx', 2, 0, () => rec);
    expect(result).toEqual({ fileName: 'App.tsx', lineNumber: 1, columnNumber: 1 });
  });

  it('returns null for compiled positions with no mapping', () => {
    const userBody = `x;\n${inlineMap(singleMappingMap('App.tsx', 1))}`;
    const compiled = wrapModuleBody('App.tsx', userBody);
    const rec: ModuleRecordLike = { path: 'App.tsx', compiledSource: compiled };
    // line 99 has no mapping in the synthetic map.
    expect(lookupSourcePosition('App.tsx', 99, 0, () => rec)).toBeNull();
  });

  it('returns null when the module record is missing', () => {
    expect(lookupSourcePosition('Missing.tsx', 1, 0, () => undefined)).toBeNull();
  });

  it('returns null when the compiled source has no inline map', () => {
    const rec: ModuleRecordLike = { path: 'App.tsx', compiledSource: 'const x = 1;' };
    expect(lookupSourcePosition('App.tsx', 1, 0, () => rec)).toBeNull();
  });

  it('returns null when the inline map is malformed base64', () => {
    const rec: ModuleRecordLike = {
      path: 'App.tsx',
      compiledSource:
        'const x = 1;\n//# sourceMappingURL=data:application/json;base64,***NOT-BASE64***',
    };
    expect(lookupSourcePosition('App.tsx', 1, 0, () => rec)).toBeNull();
  });

  it('caches the parsed TraceMap across calls', () => {
    const userBody = `x;\n${inlineMap(singleMappingMap('App.tsx', 1))}`;
    const compiled = wrapModuleBody('App.tsx', userBody);
    const rec: ModuleRecordLike = { path: 'App.tsx', compiledSource: compiled };
    let callCount = 0;
    const get = (path: string): ModuleRecordLike | undefined => {
      callCount++;
      return path === rec.path ? rec : undefined;
    };
    const first = getTraceMap('App.tsx', get);
    const second = getTraceMap('App.tsx', get);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    // First call read the record; second hit the cache without re-reading.
    expect(callCount).toBe(1);
  });

  it('invalidateTraceMap drops the cache for one path', () => {
    const userBody = `x;\n${inlineMap(singleMappingMap('App.tsx', 1))}`;
    const compiled = wrapModuleBody('App.tsx', userBody);
    let rec: ModuleRecordLike = { path: 'App.tsx', compiledSource: compiled };
    const get = (path: string): ModuleRecordLike | undefined =>
      path === rec.path ? rec : undefined;
    const first = getTraceMap('App.tsx', get);
    rec = {
      path: 'App.tsx',
      compiledSource: `y;\n${inlineMap(singleMappingMap('Other.tsx', 1))}`,
    };
    invalidateTraceMap('App.tsx');
    const second = getTraceMap('App.tsx', get);
    expect(second).not.toBe(first);
    // The new map's source name is what we just stitched in.
    const wrappedNew = wrapModuleBody('App.tsx', rec.compiledSource ?? '');
    rec = { path: 'App.tsx', compiledSource: wrappedNew };
    invalidateTraceMap('App.tsx');
  });
});
