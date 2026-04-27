import { describe, it, expect } from 'vitest';
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

describe('vendor-builder', () => {
  // Each bundle calls esbuild + dynamic-imports the package. ~1-3s per case.
  const TIMEOUT = 60_000;

  describe('Bug 1: CJS named exports are statically re-exported', () => {
    it(
      'exposes jsxDEV from react/jsx-dev-runtime as a static export',
      async () => {
        const { importMap } = await build({
          packages: ['react/jsx-dev-runtime'],
          format: 'inline',
          includeRequiredCore: false,
        });
        const code = decodeDataUrl(importMap.imports['react/jsx-dev-runtime']!);
        // Must be a real `export ... jsxDEV`, not just a runtime __reExport call.
        expect(code).toMatch(/\bexport\b[\s\S]*\bjsxDEV\b/);
        // Sanity: prove the broken path (raw `export *` over CJS) is gone.
        expect(code).not.toMatch(/^export\s*\*\s*from\s+['"]react\/jsx-dev-runtime['"]/m);
      },
      TIMEOUT,
    );

    it(
      'exposes jsx and jsxs from react/jsx-runtime',
      async () => {
        const { importMap } = await build({
          packages: ['react/jsx-runtime'],
          format: 'inline',
          includeRequiredCore: false,
        });
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
        const { importMap } = await build({
          packages: ['react', 'react-dom'],
          format: 'inline',
          includeRequiredCore: false,
        });
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
      'honors an explicit external list',
      async () => {
        const { importMap } = await build({
          packages: ['react', 'react-dom'],
          external: ['react'],
          format: 'inline',
          includeRequiredCore: false,
        });
        const reactDom = decodeDataUrl(importMap.imports['react-dom']!);
        expect(reactDom).toMatch(/import\s+\*\s+as\s+__ext_\d+\s+from\s+["']react["']/);
      },
      TIMEOUT,
    );

    it(
      'does not externalize a subpath of an external (no self-import)',
      async () => {
        // `react/jsx-runtime` is in REQUIRED_CORE, but when WE'RE building
        // it the only entry in `external` is `react` (and other packages),
        // not `react/jsx-runtime` itself. The exact-external plugin must
        // therefore leave the bundle's own primary import alone.
        const { importMap } = await build({
          packages: ['react', 'react/jsx-runtime'],
          format: 'inline',
          includeRequiredCore: false,
        });
        const jsx = decodeDataUrl(importMap.imports['react/jsx-runtime']!);
        // Banner ESM imports `react` — fine.
        expect(jsx).toMatch(/import\s+\*\s+as\s+__ext_\d+\s+from\s+["']react["']/);
        // Body must reference jsx-runtime contents, not be just a re-export.
        expect(jsx).toMatch(/\bjsx\b/);
      },
      TIMEOUT,
    );
  });

  describe('Bug 3: required core auto-include', () => {
    it(
      'prepends REQUIRED_CORE to a non-core package list',
      async () => {
        const { importMap } = await build({
          packages: ['lodash-es'],
          format: 'inline',
        });
        for (const spec of REQUIRED_CORE) {
          expect(importMap.imports).toHaveProperty(spec);
        }
        expect(importMap.imports).toHaveProperty('lodash-es');
      },
      TIMEOUT,
    );

    it(
      'opts out cleanly with includeRequiredCore: false',
      async () => {
        const { importMap } = await build({
          packages: ['lodash-es'],
          format: 'inline',
          includeRequiredCore: false,
        });
        expect(Object.keys(importMap.imports)).toEqual(['lodash-es']);
      },
      TIMEOUT,
    );

    it(
      'does not duplicate when the user already lists a core specifier',
      async () => {
        const { importMap } = await build({
          packages: ['react', 'lodash-es'],
          format: 'inline',
        });
        // react appears once; full core is still present.
        expect(Object.keys(importMap.imports).filter((k) => k === 'react')).toHaveLength(1);
        for (const spec of REQUIRED_CORE) {
          expect(importMap.imports).toHaveProperty(spec);
        }
      },
      TIMEOUT,
    );
  });
});
