import { describe, it, expect } from 'vitest';
import { buildUrlLabels, sanitizeStack } from '../../src/runtime/sanitize-stack.ts';

const REACT_DOM_URL = `data:text/javascript;base64,${btoa('function beginWork(){}'.repeat(100))}`;
const VENDOR_BLOB = 'blob:null/1f0c7a2e-vendor';

const LABELS = buildUrlLabels({
  'react-dom/client': REACT_DOM_URL,
  react: 'data:text/javascript;base64,QUFB',
  clsx: VENDOR_BLOB,
  dayjs: 'https://esm.sh/dayjs',
});

describe('buildUrlLabels', () => {
  it('inverts data: entries and skips http(s) URLs', () => {
    expect(LABELS.get(REACT_DOM_URL)).toBe('react-dom/client');
    expect(LABELS.get('data:text/javascript;base64,QUFB')).toBe('react');
    expect(LABELS.has('https://esm.sh/dayjs')).toBe(false);
  });

  it('inverts blob: entries — what the preview re-hosts vendor data URLs as', () => {
    expect(LABELS.get(VENDOR_BLOB)).toBe('clsx');
  });
});

describe('sanitizeStack', () => {
  it('replaces known data URLs with their specifier, keeping line:col (V8 shape)', () => {
    const stack = [
      'Error: boom',
      '    at App (App.tsx:7:11)',
      `    at renderWithHooks (${REACT_DOM_URL}:12034:17)`,
    ].join('\n');
    expect(sanitizeStack(stack, LABELS)).toBe(
      [
        'Error: boom',
        '    at App (App.tsx:7:11)',
        '    at renderWithHooks (react-dom/client:12034:17)',
      ].join('\n'),
    );
  });

  it('handles the paren-less SpiderMonkey/JSC shape', () => {
    const stack = `renderWithHooks@${REACT_DOM_URL}:12034:17`;
    expect(sanitizeStack(stack, LABELS)).toBe('renderWithHooks@react-dom/client:12034:17');
  });

  it('truncates data URLs that are not in the import map', () => {
    const stack = `    at foo (data:text/javascript;base64,${'Q'.repeat(500)}:1:1)`;
    const out = sanitizeStack(stack, LABELS);
    expect(out).toBe(`    at foo (data:text/javascript;base64,${'Q'.repeat(12)}…:1:1)`);
  });

  it('replaces every occurrence, not just the first', () => {
    const frame = `    at beginWork (${REACT_DOM_URL}:9:9)`;
    const out = sanitizeStack([frame, frame, frame].join('\n'), LABELS);
    expect(out.match(/react-dom\/client:9:9/g)).toHaveLength(3);
    expect(out).not.toContain('base64');
  });

  it('leaves stacks without data URLs untouched', () => {
    const stack = 'Error\n    at App (App.tsx:7:11)\n    at blob:null/abc-123:2:3';
    expect(sanitizeStack(stack, LABELS)).toBe(stack);
  });

  it('replaces known vendor blob URLs with their specifier', () => {
    const stack = `Error: boom\n    at cx (${VENDOR_BLOB}:41:9)\n    at App (App.tsx:7:11)`;
    expect(sanitizeStack(stack, LABELS)).toBe(
      'Error: boom\n    at cx (clsx:41:9)\n    at App (App.tsx:7:11)',
    );
  });

  it("leaves a user module's own blob URL alone — the source-map layer needs it", () => {
    const stack = '    at Counter (blob:null/not-a-vendor:3:1)';
    expect(sanitizeStack(stack, LABELS)).toBe(stack);
  });
});
