#!/usr/bin/env node
/**
 * `repl-vendor-build` CLI — bundles a vendor manifest into a folder containing
 * a ready-to-use TypeScript entry plus the two data leaves (import map and
 * type definitions). The entry wires *both* the import map and the types
 * via dynamic `import()` so the bundler code-splits each payload into its
 * own chunk: the import-map chunk loads when `<Repl/>` mounts; the types
 * chunk loads when the editor mounts. Routes that never mount `<Repl/>`
 * ship neither.
 *
 *   npx repl-vendor-build src/sandbox/vendor.entry.ts
 *   # → src/sandbox/vendor.generated/{index.ts,import-map.json,types.json}
 *
 *   import { customVendor } from './sandbox/vendor.generated';
 *   <ReplProvider vendor={customVendor}>…</ReplProvider>
 *
 * @internal
 */

import { build } from './build.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RunBuildOptions = {
  entry: string;
  outDir: string;
  nodeEnv: 'development' | 'production';
  types: boolean;
  /**
   * Name of the `VendorBundle` constant the generated `index.ts` exports.
   * The library's in-repo build sets this to `defaultVendor`; the CLI's
   * default for end users is `customVendor`.
   */
  exportName: string;
};

/**
 * Default output: sibling folder named after the entry, with `.generated`
 * appended so existing ignore globs (Prettier, oxlint, Knip) pick it up.
 * The `.entry.` infix is stripped if present so the input/output stems
 * stay aligned:
 *
 *   src/sandbox/vendor.entry.ts → src/sandbox/vendor.generated/
 *   src/sandbox/vendor.ts       → src/sandbox/vendor.generated/
 *
 * Any JS/TS extension is accepted (ts, tsx, js, jsx, mts, mjs, cts, cjs);
 * pass `--out <dir>` to override.
 */
export function deriveOutDir(entry: string): string {
  const file = basename(entry);
  const stripped = file.replace(/\.entry\.[mc]?[jt]sx?$/, '').replace(/\.[mc]?[jt]sx?$/, '');
  if (stripped === file) {
    throw new Error(
      `Cannot derive --out from "${entry}" (filename does not end in .ts, .tsx, .js, .jsx, .mts, .mjs, .cts, or .cjs). ` +
        'Pass --out <dir> explicitly.',
    );
  }
  return join(dirname(entry), `${stripped}.generated`);
}

function parseArgs(argv: string[]): RunBuildOptions {
  const args: Partial<RunBuildOptions> = {
    nodeEnv: 'development',
    types: true,
    exportName: 'customVendor',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out' || a === '-o') {
      args.outDir = argv[++i];
    } else if (a === '--prod') {
      args.nodeEnv = 'production';
    } else if (a === '--no-types') {
      args.types = false;
    } else if (a === '--export-name') {
      args.exportName = argv[++i];
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown argument: ${a}`);
    } else if (args.entry === undefined) {
      args.entry = a;
    } else {
      throw new Error(`Unexpected positional argument: ${a}`);
    }
  }
  if (!args.entry) {
    throw new Error(
      'Missing entry file. Usage: repl-vendor-build <entry.ts> [--out <dir>]\n' +
        '       Run with --help for details.',
    );
  }
  if (!args.outDir) {
    args.outDir = deriveOutDir(args.entry);
  }
  if (args.exportName && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(args.exportName)) {
    throw new Error(
      `--export-name must be a valid JavaScript identifier; got "${args.exportName}".`,
    );
  }
  return args as RunBuildOptions;
}

function printHelp(): void {
  process.stdout.write(`repl-vendor-build — produce a vendor bundle folder for mini-react-repl

Usage:
  repl-vendor-build <entry-file> [options]

The entry file is a TypeScript or JavaScript module that declares the bundle
shape via standard ESM \`import * as X from '<spec>'; export { X as '<key>' }\`.
Re-export the shipped iframe-runtime core by adding
\`export * from 'mini-react-repl/vendor-base'\` at the top.

Optional:
  -o, --out <dir>          output directory (default: sibling to <entry-file>,
                           named <entry-stem>.generated — the \`.entry.\` infix
                           is stripped if present, so \`vendor.entry.ts\` and
                           \`vendor.ts\` both produce \`vendor.generated/\`)
      --export-name <name> identifier the generated index.ts exports
                           (default: customVendor)
      --no-types           skip the .d.ts walk (smaller output, no editor type info)
      --prod               use NODE_ENV=production (default development).
                           Roughly halves the bundle, and drops React's dev
                           warnings and per-render profiling. The generated
                           index.ts records \`development: false\` so the
                           transform stops emitting jsxDEV to match.
                           Consequences: no Fast Refresh (production React has
                           no Refresh hook — <Repl hmr> is forced off), no
                           <InspectMode/> (no fiber debug info), and terser,
                           minified React error messages. Suits a read-only
                           preview; not an editing surface.
  -h, --help               show this help

Output folder layout:
  <out>/
    index.ts          ← exports \`<export-name>: VendorBundle\`, with lazy
                        importMap + lazy types (both via dynamic import)
    import-map.json   ← { imports: { 'react': 'data:...', ... } }
    types.json        ← { libs: { ... } }   (absent with --no-types)

Consumer:
  import { customVendor } from './vendor.generated';
  <ReplProvider vendor={customVendor} ... />

Why a folder, not a single file?
  The generated index.ts uses dynamic \`import()\` for *both* import-map.json
  and types.json, so bundlers (Webpack/Vite/Rolldown) code-split each
  payload into its own chunk. Routes that never mount <Repl/> ship neither.
  Preview-only consumers never fetch types; the editor triggers it on mount.
  An SSR window-guard short-circuits the thunks to empty payloads on the
  server so neither chunk is pulled into the SSR bundle.

  The default folder name ends in \`.generated\` so most linter/formatter
  configs (Prettier, oxlint, Knip) skip it automatically. Add the folder
  to .gitignore — regenerate with this CLI as needed.

Example entry file (vendor.entry.ts):
  export * from 'mini-react-repl/vendor-base';

  import * as zod from 'zod';
  import * as lodash from 'lodash-es';   // alias source: iframe imports 'lodash'
  export {
    zod,
    lodash,
  };

Example invocation:
  repl-vendor-build src/sandbox/vendor.entry.ts
  # → src/sandbox/vendor.generated/{index.ts,import-map.json,types.json}
`);
}

/**
 * Source of the generated `index.ts`. Both the import map and the types
 * payload are wired through dynamic `import()` so the bundler code-splits
 * each into its own chunk; routes that never mount `<Repl/>` ship neither.
 * An SSR window-guard short-circuits the thunks to empty payloads on the
 * server so the JSON chunks aren't pulled into the SSR bundle.
 */
export function renderIndexTs(opts: {
  hasTypes: boolean;
  exportName: string;
  development: boolean;
}): string {
  const typesProp = opts.hasTypes
    ? `
  types: () =>
    typeof window === 'undefined'
      ? Promise.resolve(EMPTY_TYPE_BUNDLE)
      : import(/* webpackChunkName: "mini-react-repl-types" */ './types.json').then((m) => m.default),`
    : '';
  // Only emitted for --prod. The field defaults to `true`, so a development
  // bundle stays byte-identical to what earlier versions produced.
  const developmentProp = opts.development
    ? ''
    : `
  // Production React: it doesn't implement jsxDEV, so the transform must
  // not emit it. Fast Refresh and <InspectMode/> don't work against it.
  development: false,`;
  const emptyTypeConst = opts.hasTypes
    ? `\nconst EMPTY_TYPE_BUNDLE: TypeBundle = { libs: {} };\n`
    : '';
  const typeImports = opts.hasTypes
    ? 'ImportMap, TypeBundle, VendorBundle'
    : 'ImportMap, VendorBundle';
  return `/* eslint-disable */
// @generated by repl-vendor-build — do not edit. Regenerate with
// \`repl-vendor-build <entry>\`.
//
// Drop into <ReplProvider>:
//
//   import { ${opts.exportName} } from './vendor.generated';
//   <ReplProvider vendor={${opts.exportName}}>…</ReplProvider>
//
// Loading sequence
// ================
//
//   host bundle parses
//          │
//          ▼
//   <Repl/> renders
//          │
//          ├──► [chunk] import-map.json ─┐
//          │                              │
//          │            (if editor mounts)│
//          ├──► <EditorHost/> mounts ─┐   │  parallel
//          │                          │   │  host-side
//          │                          ▼   │  fetches
//          │           [chunk] types.json │
//          │                              │
//          ▼                              ▼
//   importMap resolved ◄──────────────────┘
//          │
//          ▼
//   preview document built + blob: URL assigned to iframe.src
//          │
//          ▼
//   iframe fetches swc.wasm (parallel with types.json if still in flight)
//          │
//          ▼
//   preview renders   (+ editor gets types when types.json lands)
//
// Both JSONs ship as their own bundler chunks. Routes that never mount
// <Repl/> pay nothing for vendor data. SSR is a no-op: the window guard
// resolves to empty payloads on the server so the chunks stay out of
// the SSR bundle.
import type { ${typeImports} } from 'mini-react-repl';

const EMPTY_IMPORT_MAP: ImportMap = { imports: {} };${emptyTypeConst}
export const ${opts.exportName}: VendorBundle = {
  importMap: () =>
    typeof window === 'undefined'
      ? Promise.resolve(EMPTY_IMPORT_MAP)
      : import(/* webpackChunkName: "mini-react-repl-import-map" */ './import-map.json').then(
          (m) => m.default,
        ),${typesProp}${developmentProp}
};
`;
}

/**
 * Verify esbuild is installed before doing any other work. esbuild is an
 * optional peerDependency so consumers who only use vendor-default don't
 * pay for ~25 MB of platform-specific binaries. When it's missing here,
 * we want the install hint rather than the raw ESM resolution error.
 */
async function ensureEsbuildInstalled(): Promise<void> {
  try {
    await import('esbuild');
  } catch {
    process.stderr.write(
      "✗ repl-vendor-build requires 'esbuild', which is not installed.\n" +
        '  Install it as a dev dependency:\n' +
        '    npm i -D esbuild     (or `pnpm add -D esbuild`, `yarn add -D esbuild`)\n',
    );
    process.exit(1);
  }
}

/**
 * Run the full build → write-to-disk flow. The CLI's `main()` calls this
 * after parsing argv; `scripts/build-default-vendor.mjs` calls it directly
 * so the library's own default vendor goes through the same path users do.
 */
export async function runBuild(opts: RunBuildOptions): Promise<void> {
  const bundle = await build({
    entry: opts.entry,
    nodeEnv: opts.nodeEnv,
    types: opts.types ? 'embed' : 'omit',
  });

  const outDir = resolve(process.cwd(), opts.outDir);
  await mkdir(outDir, { recursive: true });

  const importMapPath = join(outDir, 'import-map.json');
  await writeFile(importMapPath, JSON.stringify(bundle.importMap, null, 2) + '\n', 'utf8');

  const hasTypes = !!bundle.types;
  if (bundle.types) {
    const typesPath = join(outDir, 'types.json');
    await writeFile(typesPath, JSON.stringify(bundle.types, null, 2) + '\n', 'utf8');
  }

  const indexPath = join(outDir, 'index.ts');
  await writeFile(
    indexPath,
    renderIndexTs({
      hasTypes,
      exportName: opts.exportName,
      development: opts.nodeEnv !== 'production',
    }),
    'utf8',
  );

  const files = hasTypes ? 'index.ts, import-map.json, types.json' : 'index.ts, import-map.json';
  process.stderr.write(`✓ wrote ${outDir}/ (${files})\n`);
}

async function main(): Promise<void> {
  await ensureEsbuildInstalled();
  const args = parseArgs(process.argv.slice(2));
  await runBuild(args);
}

// Only run main() when invoked as a script — not when imported by tests.
// Compare real paths because pnpm/npm symlink the bin into node_modules/.bin,
// which makes `process.argv[1]` differ from `import.meta.url` after resolution.
function isInvokedAsCli(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedAsCli()) {
  main().catch((err) => {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
