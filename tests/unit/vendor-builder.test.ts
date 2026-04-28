import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../src/vendor-builder/build.ts';

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
        const { importMap } = await build({ entry, format: 'inline', cwd });
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
        const { importMap } = await build({ entry, format: 'inline', cwd });
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
        const { importMap } = await build({ entry, format: 'inline', cwd });
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
        const { importMap } = await build({ entry, format: 'inline', cwd });
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
        await expect(build({ entry, format: 'inline', cwd })).rejects.toThrow(
          /missing required iframe-runtime specifiers[\s\S]*mini-react-repl\/vendor-base/,
        );
      },
      TIMEOUT,
    );

    it(
      'all six core specifiers populate the import map',
      async () => {
        const entry = await makeEntry(CORE_BLOCK);
        const { importMap } = await build({ entry, format: 'inline', cwd });
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
        const { importMap } = await build({ entry, format: 'inline', cwd });
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
        const { importMap } = await build({ entry, format: 'inline', cwd });
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
        const { importMap } = await build({ entry, format: 'inline', cwd });
        expect(importMap.imports).toHaveProperty('lodash');
      },
      TIMEOUT,
    );
  });

  describe('Validation errors', () => {
    it(
      'rejects a default-import-backed re-export with a fix hint',
      async () => {
        const entry = await makeEntry(`${CORE_BLOCK}
import lodash from 'lodash-es';
export { lodash };
`);
        await expect(build({ entry, format: 'inline', cwd })).rejects.toThrow(
          /not backed by a namespace import/,
        );
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
        await expect(build({ entry, format: 'inline', cwd })).rejects.toThrow(
          /not backed by a namespace import/,
        );
      },
      TIMEOUT,
    );
  });
});
