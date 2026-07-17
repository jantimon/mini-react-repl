import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build, extractImports } from '../../src/vendor-builder/build.ts';
import { deriveOutDir, renderIndexTs, runBuild } from '../../src/vendor-builder/cli.ts';

const REQUIRED_CORE = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-refresh/runtime',
];

function decodeDataUrl(url: string): string {
  const b64 = url.replace(/^data:text\/javascript;base64,/, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

const cwd = process.cwd();

const tempDirs: string[] = [];

async function makeEntry(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vendor-builder-test-'));
  tempDirs.push(dir);
  const entry = join(dir, 'vendor.ts');
  await writeFile(entry, content, 'utf8');
  return entry;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

// Re-exported core block reused by most tests. Pulls in the six required-core
// specs without lifting the project to a different cwd.
const CORE_BLOCK = `import * as react from 'react';
import * as reactDom from 'react-dom';
import * as reactDomClient from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';
import * as reactRefreshRuntime from 'react-refresh/runtime';
export {
  react,
  reactDom as 'react-dom',
  reactDomClient as 'react-dom/client',
  jsxRuntime as 'react/jsx-runtime',
  jsxDevRuntime as 'react/jsx-dev-runtime',
  reactRefreshRuntime as 'react-refresh/runtime',
};
`;

describe('vendor-builder', () => {
  // Each bundle calls esbuild + dynamic-imports the package. ~1-3s per case.
  const TIMEOUT = 60_000;

  describe('Bug 1: CJS named exports are statically re-exported', () => {
    it(
      'exposes jsxDEV from react/jsx-dev-runtime as a static export',
      async () => {
        const entry = await makeEntry(CORE_BLOCK);
        const { importMap } = await build({ entry, cwd });
        const code = decodeDataUrl(importMap.imports['react/jsx-dev-runtime']!);
        expect(code).toMatch(/\bexport\b[\s\S]*\bjsxDEV\b/);
        // Sanity: prove the broken path (raw `export *` over CJS) is gone.
        expect(code).not.toMatch(/^export\s*\*\s*from\s+['"]react\/jsx-dev-runtime['"]/m);
      },
      TIMEOUT,
    );

    it(
      'exposes jsx and jsxs from react/jsx-runtime',
      async () => {
        const entry = await makeEntry(CORE_BLOCK);
        const { importMap } = await build({ entry, cwd });
        const code = decodeDataUrl(importMap.imports['react/jsx-runtime']!);
        expect(code).toMatch(/\bexport\b[\s\S]*\bjsx\b/);
        expect(code).toMatch(/\bexport\b[\s\S]*\bjsxs\b/);
      },
      TIMEOUT,
    );
  });

  describe('Bug 2: externals prevent React duplication', () => {
    it(
      'externalizes react when listed alongside react-dom',
      async () => {
        const entry = await makeEntry(CORE_BLOCK);
        const { importMap } = await build({ entry, cwd });
        const reactDom = decodeDataUrl(importMap.imports['react-dom']!);
        // The banner injects an ESM import for the external react.
        expect(reactDom).toMatch(/import\s+\*\s+as\s+__ext_\d+\s+from\s+["']react["']/);
        // And does NOT inline React's own source (look for a sentinel string
        // that appears in react-dom.development's bundled React copy).
        expect(reactDom).not.toContain('react.development.js');
      },
      TIMEOUT,
    );

    it(
      'does not externalize a subpath of an external (no self-import)',
      async () => {
        // When bundling react/jsx-runtime, only `react` is in the candidate
        // externals — never the bundle's own primary specifier.
        const entry = await makeEntry(CORE_BLOCK);
        const { importMap } = await build({ entry, cwd });
        const jsx = decodeDataUrl(importMap.imports['react/jsx-runtime']!);
        // Banner ESM imports `react` — fine.
        expect(jsx).toMatch(/import\s+\*\s+as\s+__ext_\d+\s+from\s+["']react["']/);
        // Body must reference jsx-runtime contents, not be just a re-export.
        expect(jsx).toMatch(/\bjsx\b/);
      },
      TIMEOUT,
    );
  });

  describe('Required core validation', () => {
    it(
      'errors with vendor-base hint when core is missing',
      async () => {
        const entry = await makeEntry(`
import * as lodash from 'lodash-es';
export { lodash };
`);
        await expect(build({ entry, cwd })).rejects.toThrow(
          /missing required iframe-runtime specifiers[\s\S]*mini-react-repl\/vendor-base/,
        );
      },
      TIMEOUT,
    );

    it(
      'all six core specifiers populate the import map',
      async () => {
        const entry = await makeEntry(CORE_BLOCK);
        const { importMap } = await build({ entry, cwd });
        for (const spec of REQUIRED_CORE) {
          expect(importMap.imports).toHaveProperty(spec);
        }
      },
      TIMEOUT,
    );
  });

  describe('Aliasing', () => {
    it(
      'export rename re-keys the import map under the alias',
      async () => {
        const entry = await makeEntry(`${CORE_BLOCK}
import * as lodash from 'lodash-es';
export { lodash };
`);
        const { importMap } = await build({ entry, cwd });
        // Alias key 'lodash' present; canonical 'lodash-es' is not (we didn't
        // export it under that name).
        expect(importMap.imports).toHaveProperty('lodash');
        expect(importMap.imports).not.toHaveProperty('lodash-es');
        // Bundle is real lodash-es (`forEach` is one of its named exports).
        const code = decodeDataUrl(importMap.imports['lodash']!);
        expect(code).toMatch(/\bforEach\b/);
      },
      TIMEOUT,
    );

    it(
      'same source under multiple keys dedupes to one URL',
      async () => {
        const entry = await makeEntry(`${CORE_BLOCK}
import * as a from 'lodash-es';
import * as b from 'lodash-es';
export { a, b as 'lodash-es' };
`);
        const { importMap } = await build({ entry, cwd });
        // Both keys point at the same data: URL.
        expect(importMap.imports['a']).toBeDefined();
        expect(importMap.imports['lodash-es']).toBeDefined();
        expect(importMap.imports['a']).toBe(importMap.imports['lodash-es']);
      },
      TIMEOUT,
    );

    it(
      'namespace re-export form (export * as) works',
      async () => {
        const entry = await makeEntry(`${CORE_BLOCK}
export * as lodash from 'lodash-es';
`);
        const { importMap } = await build({ entry, cwd });
        expect(importMap.imports).toHaveProperty('lodash');
      },
      TIMEOUT,
    );
  });

  describe('extractImports (transitive .d.ts walker)', () => {
    it('extracts static, type-only, re-export, and dynamic imports', async () => {
      const src = `
        import { A } from 'pkg-a';
        import type { B } from 'pkg-b';
        export { C } from './c';
        export * from 'pkg-d';
        declare const x: import('pkg-e').Foo;
      `;
      const specs = (await extractImports(src)).sort();
      expect(specs).toEqual(['./c', 'pkg-a', 'pkg-b', 'pkg-d', 'pkg-e']);
    });

    it('treats `.` and `..` as relative directory specifiers', async () => {
      const src = `export * from '.'; export { X } from '..';`;
      expect((await extractImports(src)).sort()).toEqual(['.', '..']);
    });

    it('ignores `from` / `import` tokens inside string literals', async () => {
      // Mirrors `recharts/types/util/svgPropertiesNoEvents.d.ts` — the
      // regex-based predecessor matched `from", "fx"` inside the tuple and
      // captured `, ` as a phantom specifier, producing
      // `[vendor-builder] no .d.ts found for ', ', skipping` warnings.
      const src = `
        declare const SVGAttrs: readonly ["format", "from", "fx", "import", "fy"];
        export { SVGAttrs };
      `;
      expect(await extractImports(src)).toEqual([]);
    });

    it('ignores `from` / `import` tokens inside comments', async () => {
      const src = `
        // import { fake } from 'should-not-be-extracted';
        /* import { also } from 'nope'; */
        import { real } from 'real-pkg';
      `;
      expect(await extractImports(src)).toEqual(['real-pkg']);
    });
  });

  describe('Validation errors', () => {
    it(
      'rejects a default-import-backed re-export with a fix hint',
      async () => {
        const entry = await makeEntry(`${CORE_BLOCK}
import lodash from 'lodash-es';
export { lodash };
`);
        await expect(build({ entry, cwd })).rejects.toThrow(/not backed by a namespace import/);
      },
      TIMEOUT,
    );

    it(
      'rejects a partial named re-export with the same actionable hint',
      async () => {
        const entry = await makeEntry(`${CORE_BLOCK}
export { forEach } from 'lodash-es';
`);
        // esbuild desugars to `import { forEach } from 'lodash-es'`, which
        // hits the same code path as a default import — same message.
        await expect(build({ entry, cwd })).rejects.toThrow(/not backed by a namespace import/);
      },
      TIMEOUT,
    );
  });

  describe('CLI helpers', () => {
    describe('deriveOutDir', () => {
      it('strips .entry.ts and appends .generated', () => {
        expect(deriveOutDir('src/sandbox/vendor.entry.ts')).toBe(
          join('src/sandbox', 'vendor.generated'),
        );
      });

      it('strips a plain JS/TS extension when .entry. is absent', () => {
        expect(deriveOutDir('src/vendor.ts')).toBe(join('src', 'vendor.generated'));
        expect(deriveOutDir('vendor.ts')).toBe('vendor.generated');
        expect(deriveOutDir('src/repl.vendor.ts')).toBe(join('src', 'repl.vendor.generated'));
      });

      it('handles tsx, jsx, js, mts, mjs, cts, cjs', () => {
        expect(deriveOutDir('a/b.entry.tsx')).toBe(join('a', 'b.generated'));
        expect(deriveOutDir('a/b.entry.jsx')).toBe(join('a', 'b.generated'));
        expect(deriveOutDir('a/b.entry.js')).toBe(join('a', 'b.generated'));
        expect(deriveOutDir('a/b.entry.mts')).toBe(join('a', 'b.generated'));
        expect(deriveOutDir('a/b.entry.cjs')).toBe(join('a', 'b.generated'));
        expect(deriveOutDir('a/b.tsx')).toBe(join('a', 'b.generated'));
        expect(deriveOutDir('a/b.mjs')).toBe(join('a', 'b.generated'));
        expect(deriveOutDir('a/b.cts')).toBe(join('a', 'b.generated'));
      });

      it('handles a bare-filename entry', () => {
        expect(deriveOutDir('vendor.entry.ts')).toBe('vendor.generated');
      });

      it('throws when the filename has no JS/TS extension', () => {
        expect(() => deriveOutDir('vendor.json')).toThrow(/does not end in/);
        expect(() => deriveOutDir('vendor')).toThrow(/does not end in/);
      });
    });

    describe('renderIndexTs', () => {
      it('emits a VendorBundle with lazy import map AND lazy types when hasTypes: true', () => {
        const out = renderIndexTs({
          hasTypes: true,
          exportName: 'customVendor',
          development: true,
          outDirName: 'vendor.generated',
        });
        // importMap is lazy now — no static `import importMap from ...`
        expect(out).not.toContain("import importMap from './import-map.json'");
        // both chunks are dynamically imported
        expect(out).toContain(
          'import(/* webpackChunkName: "mini-react-repl-import-map" */ \'./import-map.json\')',
        );
        expect(out).toContain(
          'import(/* webpackChunkName: "mini-react-repl-types" */ \'./types.json\')',
        );
        expect(out).toContain('.then(\n          (m) => m.default,\n        )');
        // SSR no-op short-circuits both thunks on the server
        expect(out).toContain("typeof window === 'undefined'");
        expect(out).toContain('EMPTY_IMPORT_MAP');
        expect(out).toContain('EMPTY_TYPE_BUNDLE');
        // export shape
        expect(out).toContain('export const customVendor: VendorBundle');
        expect(out).toContain('importMap: () =>');
        expect(out).toContain('types: () =>');
        // lint/format pragmas
        expect(out).toContain('/* eslint-disable */');
        expect(out).toContain('// @generated by repl-vendor-build');
        // loading-sequence chart in the header
        expect(out).toContain('Loading sequence');
      });

      it('omits types wiring (but keeps lazy import map) when hasTypes: false', () => {
        const out = renderIndexTs({
          hasTypes: false,
          exportName: 'customVendor',
          development: true,
          outDirName: 'vendor.generated',
        });
        expect(out).toContain(
          'import(/* webpackChunkName: "mini-react-repl-import-map" */ \'./import-map.json\')',
        );
        expect(out).toContain('importMap: () =>');
        expect(out).toContain('EMPTY_IMPORT_MAP');
        expect(out).toContain("typeof window === 'undefined'");
        expect(out).not.toContain('./types.json');
        expect(out).not.toContain('types:');
        expect(out).not.toContain('EMPTY_TYPE_BUNDLE');
      });

      it('records development: false so the transform stops emitting jsxDEV', () => {
        const out = renderIndexTs({
          hasTypes: true,
          exportName: 'customVendor',
          development: false,
          outDirName: 'vendor.generated',
        });
        expect(out).toContain('development: false,');
      });

      it('omits development for a dev bundle — the field defaults to true', () => {
        const out = renderIndexTs({
          hasTypes: true,
          exportName: 'customVendor',
          development: true,
          outDirName: 'vendor.generated',
        });
        expect(out).not.toContain('development:');
      });

      it('honours --export-name by renaming the exported identifier', () => {
        const out = renderIndexTs({
          hasTypes: true,
          exportName: 'defaultVendor',
          development: true,
          outDirName: 'vendor.generated',
        });
        expect(out).toContain('export const defaultVendor: VendorBundle');
        expect(out).not.toContain('export const customVendor');
        // Header comment hint mirrors the chosen name.
        expect(out).toContain('import { defaultVendor }');
      });

      it('interpolates outDirName into the header import path', () => {
        const out = renderIndexTs({
          hasTypes: false,
          exportName: 'viewVendor',
          development: false,
          outDirName: 'vendor-view.generated',
        });
        expect(out).toContain("import { viewVendor } from './vendor-view.generated';");
      });
    });

    describe('runBuild', () => {
      it(
        'names the --out folder in the generated header',
        async () => {
          const entry = await makeEntry(CORE_BLOCK);
          const outDir = join(dirname(entry), 'vendor-view.generated');

          await runBuild({
            entry,
            outDir,
            nodeEnv: 'development',
            types: false,
            exportName: 'viewVendor',
          });

          const index = await readFile(join(outDir, 'index.ts'), 'utf8');
          expect(index).toContain("import { viewVendor } from './vendor-view.generated';");
        },
        TIMEOUT,
      );
    });
  });
});
