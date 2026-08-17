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

  it('extracts named Firefox/Safari frames (`FnName@path:line:col`)', () => {
    const stack = `App@App.tsx:7:7\nCounter@Counter.tsx:3:11`;
    const frames = parseStack(stack);
    expect(frames).toEqual([
      { functionName: 'App', fileName: 'App.tsx', line: 7, col: 7 },
      { functionName: 'Counter', fileName: 'Counter.tsx', line: 3, col: 11 },
    ]);
  });

  it('extracts anonymous Firefox/Safari frames (`@path:line:col`)', () => {
    const stack = `@App.tsx:42:5`;
    const frames = parseStack(stack);
    expect(frames).toEqual([{ functionName: null, fileName: 'App.tsx', line: 42, col: 5 }]);
  });

  it('handles a real-world Firefox owner stack (React 19 dev build)', () => {
    // Captured from React's `_debugStack` in Firefox 129 — includes
    // generator (`*`) and closure (`/<`) suffixes on functionName, and
    // `blob:null/<uuid>` vendor URLs from the mini-repl iframe runtime.
    const stack = [
      'node_modules/react/cjs/react-jsx-dev-runtime.development.js/exports.jsxDEV@blob:null/2ea09fae:280:30',
      'StatCard@App.tsx:247:41',
      'react_stack_bottom_frame@blob:null/c2f76ecb:18797:20',
      'VoidFunction*scheduleImmediateRootScheduleTask@blob:null/c2f76ecb:13815:26',
      '@blob:http://localhost:3000/459b781f:259:15',
    ].join('\n');
    const frames = parseStack(stack);
    expect(frames).toHaveLength(5);
    expect(frames[1]).toEqual({
      functionName: 'StatCard',
      fileName: 'App.tsx',
      line: 247,
      col: 41,
    });
    expect(frames[4]).toEqual({
      functionName: null,
      fileName: 'blob:http://localhost:3000/459b781f',
      line: 259,
      col: 15,
    });
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
      'data:application/javascript;base64,Zm9v',
      'file:///x.js',
      'webpack://./node_modules/react.js',
      'about:srcdoc',
    ]) {
      expect(isSourceCandidate({ functionName: null, fileName, line: 1, col: 1 })).toBe(false);
    }
  });

  it("accepts blob: URLs — Safari reports a wrapped module's own blob URL instead of its `//# sourceURL`, and `getModuleRecord`'s blob-URL fallback is what actually resolves it (or safely misses for a real vendor blob)", () => {
    expect(
      isSourceCandidate({ functionName: 'App', fileName: 'blob:null/abc-123', line: 1, col: 1 }),
    ).toBe(true);
  });

  it('rejects empty filenames', () => {
    expect(isSourceCandidate({ functionName: 'x', fileName: '', line: 1, col: 1 })).toBe(false);
  });
});
