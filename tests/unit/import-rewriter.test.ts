import { describe, it, expect, beforeAll } from 'vitest';
import {
  initLexer,
  rewriteImports,
  ResolveError,
  VIRTUAL_KEY_PREFIX,
} from '../../src/engine/import-rewriter.ts';

describe('import-rewriter', () => {
  beforeAll(async () => {
    await initLexer();
  });

  it('passes bare specifiers through unchanged', () => {
    const code = `import { format } from 'date-fns'\nformat(new Date())\n`;
    const r = rewriteImports('App.tsx', code, { 'App.tsx': '' });
    expect(r.code).toContain(`from 'date-fns'`);
    expect(r.bareSpecifiers).toContain('date-fns');
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
    expect(r.bareSpecifiers).toEqual([]);
    // The literal `'@foo/bar'` must remain so the iframe runtime's
    // string-replace pass can substitute it for the blob URL.
    expect(r.code).toContain(`'@foo/bar'`);
  });

  it('passes bare specifiers through when no alias set is provided', () => {
    const code = `import { greet } from '@foo/bar'\n`;
    const r = rewriteImports('App.tsx', code, { 'App.tsx': '' });
    expect(r.deps).toEqual([]);
    expect(r.bareSpecifiers).toContain('@foo/bar');
  });

  it('records virtual aliases for dynamic imports', () => {
    const code = `const m = import('@foo/bar')\n`;
    const aliases = new Set(['@foo/bar']);
    const r = rewriteImports('App.tsx', code, { 'App.tsx': '' }, aliases);
    expect(r.deps).toEqual([{ specifier: '@foo/bar', target: VIRTUAL_KEY_PREFIX + '@foo/bar' }]);
    expect(r.bareSpecifiers).toEqual([]);
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
});
