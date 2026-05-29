import { describe, it, expect, beforeAll } from 'vitest';
import {
  initLexer,
  rewriteImports,
  ResolveError,
  VIRTUAL_KEY_PREFIX,
} from '../../src/engine/import-rewriter.ts';

// Echoes the specifier + shared deps back so assertions can see both arrived.
const cdn = (specifier: string, shared: string[]) =>
  `https://cdn.test/${specifier}?external=${shared.join(',')}`;

// A resolver that captures the `declaredVersions` 4th arg for assertion.
function capturingResolver() {
  let captured: Record<string, string> | undefined;
  const resolver = (s: string, _d: string[], _p: string, declared?: Record<string, string>) => {
    captured = declared;
    return `https://cdn.test/${s}`;
  };
  return { resolver, get: () => captured };
}

describe('import-rewriter', () => {
  beforeAll(async () => {
    await initLexer();
  });

  it('passes bare specifiers through unchanged', () => {
    const code = `import { format } from 'date-fns'\nformat(new Date())\n`;
    const r = rewriteImports('App.tsx', code, { 'App.tsx': '' });
    expect(r.code).toContain(`from 'date-fns'`);
    expect(r.deps).toEqual([]);
  });

  it('normalizes relative specifiers to extension-included paths', () => {
    const code = `import x from './helper'\nx()\n`;
    const files = { 'App.tsx': '', 'helper.ts': 'export default 1' };
    const r = rewriteImports('App.tsx', code, files);
    expect(r.code).toContain(`./helper.ts`);
    expect(r.code).not.toContain(`'./helper'`);
    expect(r.deps).toEqual([{ specifier: './helper.ts', target: 'helper.ts' }]);
  });

  it('throws ResolveError for missing relative specifier', () => {
    const code = `import x from './missing'\n`;
    expect(() => rewriteImports('App.tsx', code, { 'App.tsx': '' })).toThrow(ResolveError);
  });

  it('treats a `../` specifier as relative (never bare) and rejects it', () => {
    // The file namespace is flat, so `../` can't resolve — but it must surface
    // as a ResolveError, not slip past as a bare specifier (and, with a CDN
    // configured, become a garbage `esm.sh/../foo` URL).
    const code = `import x from '../foo'\n`;
    expect(() => rewriteImports('App.tsx', code, { 'App.tsx': '' })).toThrow(ResolveError);
    expect(() =>
      rewriteImports('App.tsx', code, { 'App.tsx': '' }, undefined, {
        vendorKeys: new Set(['react']),
        cdn,
      }),
    ).toThrow(ResolveError);
  });

  it('handles dynamic import specifiers', () => {
    const code = `const x = import('./lazy')\n`;
    const files = { 'App.tsx': '', 'lazy.ts': 'export default 1' };
    const r = rewriteImports('App.tsx', code, files);
    expect(r.code).toContain(`'./lazy.ts'`);
    expect(r.deps).toEqual([{ specifier: './lazy.ts', target: 'lazy.ts' }]);
  });

  it('records virtual aliases as deps when matched', () => {
    const code = `import { greet } from '@foo/bar'\ngreet('world')\n`;
    const aliases = new Set(['@foo/bar']);
    const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, aliases);
    expect(r.deps).toEqual([{ specifier: '@foo/bar', target: VIRTUAL_KEY_PREFIX + '@foo/bar' }]);
    // The literal `'@foo/bar'` must remain so the iframe runtime's
    // string-replace pass can substitute it for the blob URL.
    expect(r.code).toContain(`'@foo/bar'`);
  });

  it('passes bare specifiers through when no alias set is provided', () => {
    const code = `import { greet } from '@foo/bar'\n`;
    const r = rewriteImports('App.tsx', code, { 'App.tsx': '' });
    expect(r.deps).toEqual([]);
    expect(r.code).toContain(`from '@foo/bar'`);
  });

  it('records virtual aliases for dynamic imports', () => {
    const code = `const m = import('@foo/bar')\n`;
    const aliases = new Set(['@foo/bar']);
    const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, aliases);
    expect(r.deps).toEqual([{ specifier: '@foo/bar', target: VIRTUAL_KEY_PREFIX + '@foo/bar' }]);
    expect(r.code).toContain(`'@foo/bar'`);
  });

  it('rewrites a relative CSS import to an empty data: URL and skips the dep', () => {
    // A real relative specifier can't resolve against the module's blob: URL,
    // so the import must be substituted for a no-op JS module. The engine
    // injects the CSS via <style> tag separately.
    const code = `import './App.css'\nexport default 1\n`;
    const files = { 'App.tsx': '', 'App.css': 'h1 { color: red }' };
    const r = rewriteImports('App.tsx', code, files);
    expect(r.code).toContain(`'data:text/javascript,'`);
    expect(r.code).not.toContain(`'./App.css'`);
    expect(r.deps).toEqual([]);
  });

  it('rewrites a dynamic CSS import to a quoted empty data: URL', () => {
    const code = `await import('./theme.css')\n`;
    const files = { 'App.tsx': '', 'theme.css': '' };
    const r = rewriteImports('App.tsx', code, files);
    expect(r.code).toContain(`'data:text/javascript,'`);
    expect(r.code).not.toContain(`'./theme.css'`);
    expect(r.deps).toEqual([]);
  });

  describe('CDN resolution for unknown bare specifiers', () => {
    const vendorKeys = new Set(['react', 'react-dom', 'react/jsx-runtime']);

    it('passes a vendor key through to the import map (never to the CDN)', () => {
      const code = `import { useState } from 'react'\n`;
      const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, undefined, { vendorKeys, cdn });
      expect(r.code).toContain(`from 'react'`);
      expect(r.code).not.toContain('cdn.test');
      expect(r.deps).toEqual([]);
    });

    it('rewrites an unknown bare specifier to the CDN URL with shared deps', () => {
      const code = `import confetti from 'canvas-confetti'\n`;
      const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, undefined, { vendorKeys, cdn });
      // Shared deps are reduced to package names and deduped: the subpath key
      // `react/jsx-runtime` collapses into `react`.
      expect(r.code).toContain(`from 'https://cdn.test/canvas-confetti?external=react,react-dom'`);
      // Absolute URL → bypasses the import map → not a tracked dep.
      expect(r.deps).toEqual([]);
    });

    it('treats a subpath under a trailing-slash prefix mapping as vendored', () => {
      // The import map serves `@scope/ui/` as a prefix mapping; a subpath
      // import under it must pass through to the import map, not the CDN.
      const prefixKeys = new Set(['react', '@scope/ui/']);
      const code = `import { Button } from '@scope/ui/button'\n`;
      const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, undefined, {
        vendorKeys: prefixKeys,
        cdn,
      });
      expect(r.code).toContain(`from '@scope/ui/button'`);
      expect(r.code).not.toContain('cdn.test');
      expect(r.deps).toEqual([]);
    });

    it('reduces a scoped shared dep to its package name in ?external', () => {
      const scopedKeys = new Set(['react', '@mui/material', '@mui/material/styles']);
      const code = `import confetti from 'canvas-confetti'\n`;
      const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, undefined, {
        vendorKeys: scopedKeys,
        cdn,
      });
      expect(r.code).toContain(`?external=react,@mui/material'`);
    });

    it('rewrites an unknown specifier in a dynamic import', () => {
      const code = `const m = await import('canvas-confetti')\n`;
      const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, undefined, { vendorKeys, cdn });
      expect(r.code).toContain(`import('https://cdn.test/canvas-confetti?external=`);
    });

    it('leaves the specifier untouched when the resolver returns null', () => {
      const code = `import x from 'mystery-pkg'\n`;
      const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, undefined, {
        vendorKeys,
        cdn: () => null,
      });
      expect(r.code).toContain(`from 'mystery-pkg'`);
      expect(r.deps).toEqual([]);
    });

    it('prefers a virtual alias over the CDN', () => {
      const code = `import { greet } from '@foo/bar'\n`;
      const aliases = new Set(['@foo/bar']);
      const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, aliases, { vendorKeys, cdn });
      expect(r.code).not.toContain('cdn.test');
      expect(r.deps).toEqual([{ specifier: '@foo/bar', target: VIRTUAL_KEY_PREFIX + '@foo/bar' }]);
    });

    it('passes unknown bare specifiers through when no resolver is configured', () => {
      const code = `import x from 'canvas-confetti'\n`;
      const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, undefined, { vendorKeys });
      expect(r.code).toContain(`from 'canvas-confetti'`);
      expect(r.deps).toEqual([]);
    });

    it('forwards resolution.declaredVersions to the CDN resolver', () => {
      // Parsing a `package.json` is PackageManifest's job (see its own suite);
      // the rewriter only forwards whatever pins it's handed.
      const { resolver, get } = capturingResolver();
      rewriteImports('App.tsx', `import c from 'canvas-confetti'\n`, { 'App.tsx': '' }, undefined, {
        vendorKeys,
        cdn: resolver,
        declaredVersions: { 'canvas-confetti': '1.9.3' },
      });
      expect(get()).toEqual({ 'canvas-confetti': '1.9.3' });
    });

    it('forwards undefined declaredVersions when none are configured', () => {
      const { resolver, get } = capturingResolver();
      rewriteImports('App.tsx', `import c from 'canvas-confetti'\n`, { 'App.tsx': '' }, undefined, {
        vendorKeys,
        cdn: resolver,
      });
      expect(get()).toBeUndefined();
    });
  });
});
