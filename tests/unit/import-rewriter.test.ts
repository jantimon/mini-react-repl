import { describe, it, expect, beforeAll } from 'vitest';
import { initLexer, rewriteImports, ResolveError } from '../../src/engine/import-rewriter.ts';

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
});
