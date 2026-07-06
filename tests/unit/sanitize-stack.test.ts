import { describe, it, expect } from 'vitest';
import { buildDataUrlLabels, sanitizeStack } from '../../src/runtime/sanitize-stack.ts';

const REACT_DOM_URL = `data:text/javascript;base64,${btoa('function beginWork(){}'.repeat(100))}`;

const LABELS = buildDataUrlLabels({
  'react-dom/client': REACT_DOM_URL,
  react: 'data:text/javascript;base64,QUFB',
  dayjs: 'https://esm.sh/dayjs',
});

describe('buildDataUrlLabels', () => {
  it('inverts data: entries and skips non-data URLs', () => {
    expect(LABELS.get(REACT_DOM_URL)).toBe('react-dom/client');
    expect(LABELS.get('data:text/javascript;base64,QUFB')).toBe('react');
    expect(LABELS.has('https://esm.sh/dayjs')).toBe(false);
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
});
