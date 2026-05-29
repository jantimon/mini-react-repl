import { describe, it, expect } from 'vitest';
import { createEsmShCdnHandler } from '../../src/cdn-esmsh.ts';

const SHARED = ['react', 'react-dom', 'react/jsx-runtime'];

describe('createEsmShCdnHandler', () => {
  it('builds an esm.sh URL with the shared deps as raw ?external', () => {
    const resolve = createEsmShCdnHandler();
    // Commas must stay raw (not %2C) — that's the whole reason we avoid
    // URLSearchParams.
    expect(resolve('canvas-confetti', SHARED, 'App.tsx')).toBe(
      'https://esm.sh/canvas-confetti?external=react,react-dom,react/jsx-runtime',
    );
  });

  it('inserts the pinned version between the name and the subpath', () => {
    const resolve = createEsmShCdnHandler({ versions: { lodash: '4.17.21' } });
    expect(resolve('lodash/fp', SHARED, 'App.tsx')).toBe(
      'https://esm.sh/lodash@4.17.21/fp?external=react,react-dom,react/jsx-runtime',
    );
  });

  it('keeps a scoped package name intact and splits its subpath', () => {
    const resolve = createEsmShCdnHandler();
    expect(resolve('@mui/material/styles', [], 'App.tsx')).toBe(
      'https://esm.sh/@mui/material/styles',
    );
  });

  it('emits boolean query flags valueless and string flags as name=value', () => {
    const resolve = createEsmShCdnHandler({
      query: { bundle: true, target: 'es2022', dev: false },
    });
    const url = resolve('canvas-confetti', [], 'App.tsx');
    expect(url).toBe('https://esm.sh/canvas-confetti?bundle&target=es2022');
  });

  it('URL-encodes string query values so reserved characters cannot corrupt the query', () => {
    const resolve = createEsmShCdnHandler({ query: { deps: 'react@18&foo=bar' } });
    expect(resolve('canvas-confetti', [], 'App.tsx')).toBe(
      'https://esm.sh/canvas-confetti?deps=react%4018%26foo%3Dbar',
    );
  });

  it('honours a custom origin (self-hosted mirror)', () => {
    const resolve = createEsmShCdnHandler({ origin: 'https://esm.mycorp.dev' });
    expect(resolve('canvas-confetti', [], 'App.tsx')).toBe(
      'https://esm.mycorp.dev/canvas-confetti',
    );
  });

  it('pins from declaredVersions (a REPL package.json) when the option omits it', () => {
    const resolve = createEsmShCdnHandler();
    expect(resolve('canvas-confetti', [], 'App.tsx', { 'canvas-confetti': '1.9.3' })).toBe(
      'https://esm.sh/canvas-confetti@1.9.3',
    );
  });

  it('lets the explicit versions option win over declaredVersions', () => {
    const resolve = createEsmShCdnHandler({ versions: { 'canvas-confetti': '1.9.3' } });
    expect(resolve('canvas-confetti', [], 'App.tsx', { 'canvas-confetti': '2.0.0' })).toBe(
      'https://esm.sh/canvas-confetti@1.9.3',
    );
  });

  it('ignores protocol ranges in declaredVersions (workspace:/file: cannot pin)', () => {
    const resolve = createEsmShCdnHandler();
    expect(resolve('canvas-confetti', [], 'App.tsx', { 'canvas-confetti': 'workspace:*' })).toBe(
      'https://esm.sh/canvas-confetti',
    );
  });

  it('looks up declaredVersions by package name for a subpath import', () => {
    const resolve = createEsmShCdnHandler();
    expect(resolve('lodash/fp', [], 'App.tsx', { lodash: '4.17.21' })).toBe(
      'https://esm.sh/lodash@4.17.21/fp',
    );
  });

  it('returns null for specifiers the allowlist rejects', () => {
    const resolve = createEsmShCdnHandler({ allow: (s) => s === 'canvas-confetti' });
    expect(resolve('canvas-confetti', [], 'App.tsx')).toBe('https://esm.sh/canvas-confetti');
    expect(resolve('left-pad', [], 'App.tsx')).toBeNull();
  });
});
