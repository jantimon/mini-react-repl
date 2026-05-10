import { describe, it, expect } from 'vitest';
import { parseStack, isSourceCandidate } from '../../src/inspect/picker/parse-stack.ts';

describe('parseStack', () => {
  it('extracts named V8 frames', () => {
    const stack = `Error
    at App (App.tsx:7:7)
    at Counter (Counter.tsx:3:11)`;
    const frames = parseStack(stack);
    expect(frames).toEqual([
      { functionName: 'App', fileName: 'App.tsx', line: 7, col: 7 },
      { functionName: 'Counter', fileName: 'Counter.tsx', line: 3, col: 11 },
    ]);
  });

  it('extracts bare V8 frames (anonymous / module-level)', () => {
    const stack = `Error
    at App.tsx:42:5`;
    const frames = parseStack(stack);
    expect(frames).toEqual([{ functionName: null, fileName: 'App.tsx', line: 42, col: 5 }]);
  });

  it('drops malformed lines and the leading message', () => {
    const stack = `Error: react-stack-top-frame
    not a frame
    at App (App.tsx:1:1)
    at  (no path)`;
    const frames = parseStack(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.functionName).toBe('App');
  });

  it('handles vendor URLs and opaque schemes — passes them through', () => {
    const stack = `Error
    at jsxDEV (https://cdn/react/jsx-dev-runtime.js:99:1)
    at App (App.tsx:5:3)
    at  blob:http://x/abc:1:1`;
    const frames = parseStack(stack);
    expect(frames.map((f) => f.fileName)).toEqual([
      'https://cdn/react/jsx-dev-runtime.js',
      'App.tsx',
      'blob:http://x/abc',
    ]);
  });
});

describe('isSourceCandidate', () => {
  it('accepts paths produced by `//# sourceURL` (bare path)', () => {
    expect(isSourceCandidate({ functionName: 'App', fileName: 'App.tsx', line: 1, col: 1 })).toBe(
      true,
    );
    expect(
      isSourceCandidate({ functionName: null, fileName: '/src/App.tsx', line: 1, col: 1 }),
    ).toBe(true);
  });

  it('rejects vendor and infrastructure schemes', () => {
    for (const fileName of [
      'https://cdn/react.js',
      'http://localhost/x.js',
      'blob:http://x/y',
      'data:application/javascript;base64,Zm9v',
      'file:///x.js',
      'webpack://./node_modules/react.js',
      'about:srcdoc',
    ]) {
      expect(isSourceCandidate({ functionName: null, fileName, line: 1, col: 1 })).toBe(false);
    }
  });

  it('rejects empty filenames', () => {
    expect(isSourceCandidate({ functionName: 'x', fileName: '', line: 1, col: 1 })).toBe(false);
  });
});
