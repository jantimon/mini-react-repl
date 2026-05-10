import { describe, it, expect } from 'vitest';
import { wrapModuleBody, shiftInlineSourceMap } from '../../src/runtime/module-wrapper.ts';

function makeInlineMap(map: object): string {
  const json = JSON.stringify(map);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return '//# sourceMappingURL=data:application/json;base64,' + btoa(bin);
}

function readInlineMap(s: string): { mappings: string; sourcesContent?: string[] } {
  const m = s.match(/data:application\/json(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)/);
  if (!m) throw new Error('no inline map');
  const bin = atob(m[1]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

const LS = ' ';
const PS = ' ';

describe('wrapModuleBody', () => {
  it('appends a sourceURL pragma with the path on the last line', () => {
    const out = wrapModuleBody('/src/App.tsx', 'export default () => null;');
    const lines = out.split('\n');
    expect(lines[lines.length - 1]).toBe('//# sourceURL=/src/App.tsx');
  });

  it('embeds the JSON-stringified path in the Refresh hooks and commit call', () => {
    const out = wrapModuleBody('/src/App.tsx', 'body');
    expect(out).toContain('__repl__.refresh.register("/src/App.tsx", type, id)');
    expect(out).toContain('__repl__.commit("/src/App.tsx");');
  });

  it('places the user body between the Refresh setup and teardown', () => {
    const out = wrapModuleBody('/x.ts', '/* USER_BODY */');
    const setupIdx = out.indexOf('window.$RefreshSig$ = () =>');
    const bodyIdx = out.indexOf('/* USER_BODY */');
    const teardownIdx = out.indexOf('window.$RefreshReg$ = __prevReg;');
    expect(setupIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(setupIdx);
    expect(teardownIdx).toBeGreaterThan(bodyIdx);
  });

  it('percent-encodes all four JS line terminators (LF, CR, U+2028, U+2029)', () => {
    // Any of these would otherwise close the // sourceURL comment.
    const path = `/a\nb\rc${LS}d${PS}e.tsx`;
    const out = wrapModuleBody(path, '');
    const lastLine = out.split('\n').pop()!;
    expect(lastLine).toBe('//# sourceURL=/a%0Ab%0Dc%E2%80%A8d%E2%80%A9e.tsx');
    // Defense in depth: no raw terminator should remain in the pragma.
    expect(lastLine).not.toMatch(/[\r\n\u2028\u2029]/);
  });

  it("percent-encodes whitespace and quotes so V8's sourceURL parser doesn't truncate", () => {
    // V8 matches sourceURL as `[^\s'"]*` — a literal space, tab, or quote in
    // the path would be silently dropped from the DevTools display.
    const out = wrapModuleBody('/My Project/a"b\'c.tsx', '');
    const lastLine = out.split('\n').pop()!;
    expect(lastLine).toBe('//# sourceURL=/My%20Project/a%22b%27c.tsx');
  });

  it('leaves URL-safe path characters (slashes, dots, dashes) untouched', () => {
    const out = wrapModuleBody('/src/feature-a/index.tsx', '');
    expect(out.endsWith('//# sourceURL=/src/feature-a/index.tsx')).toBe(true);
  });

  it('shifts an inline source map in the body to account for the prologue', () => {
    // The prologue is one line, so body line 1 ends up on wrapped line 2.
    // The shifted map should have one leading semicolon in `mappings`.
    const original = makeInlineMap({
      version: 3,
      sources: ['App.tsx'],
      mappings: 'AAAA,BBBB;CCCC,DDDD',
    });
    const out = wrapModuleBody('/App.tsx', `const x = 1;\n${original}`);
    const map = readInlineMap(out);
    expect(map.mappings).toBe(';AAAA,BBBB;CCCC,DDDD');
  });

  it('passes through bodies with no inline source map', () => {
    const out = wrapModuleBody('/x.ts', 'const x = 1;');
    // Should not crash and should not invent a sourceMappingURL.
    expect(out).not.toContain('sourceMappingURL');
  });
});

describe('shiftInlineSourceMap', () => {
  it('prepends N semicolons to the mappings string', () => {
    const input = makeInlineMap({ version: 3, sources: [], mappings: 'AAAA' });
    const out = shiftInlineSourceMap(input, 3);
    expect(readInlineMap(out).mappings).toBe(';;;AAAA');
  });

  it('round-trips non-ASCII sourcesContent through UTF-8 base64', () => {
    // Latin-1-only atob/btoa would corrupt or throw on these chars.
    const input = makeInlineMap({
      version: 3,
      sources: ['App.tsx'],
      sourcesContent: ['// café — 🍰\nconst x = 1;\n'],
      mappings: 'AAAA',
    });
    const out = shiftInlineSourceMap(input, 2);
    const map = readInlineMap(out) as { sourcesContent: string[]; mappings: string };
    expect(map.mappings).toBe(';;AAAA');
    expect(map.sourcesContent[0]).toBe('// café — 🍰\nconst x = 1;\n');
  });

  it('is a no-op when prependLines is 0', () => {
    const input = 'const x = 1;\n' + makeInlineMap({ version: 3, sources: [], mappings: 'AAAA' });
    expect(shiftInlineSourceMap(input, 0)).toBe(input);
  });

  it('is a no-op when no sourceMappingURL comment is present', () => {
    expect(shiftInlineSourceMap('const x = 1;', 5)).toBe('const x = 1;');
  });

  it('preserves empty mappings (just emits N semicolons)', () => {
    const input = makeInlineMap({ version: 3, sources: [], mappings: '' });
    const out = shiftInlineSourceMap(input, 4);
    expect(readInlineMap(out).mappings).toBe(';;;;');
  });

  it('leaves the comment untouched if the base64 payload is malformed', () => {
    // Truncated/illegal base64 → atob throws → we swallow and return input.
    const input = '//# sourceMappingURL=data:application/json;base64,not!!!base64!!!';
    expect(shiftInlineSourceMap(input, 5)).toBe(input);
  });
});
