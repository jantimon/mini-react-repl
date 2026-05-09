import { describe, it, expect } from 'vitest';
import { wrapModuleBody } from '../../src/runtime/module-wrapper.ts';

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
});
