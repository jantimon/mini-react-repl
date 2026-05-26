#!/usr/bin/env node
/**
 * `repl-vendor-build` CLI — bundles a vendor manifest into a single JSON
 * file with `data:` URLs for every entry. The output is bundler-importable;
 * pass it straight to `<Repl vendor={...} />`.
 *
 *   npx repl-vendor-build vendor.ts --out src/vendor/repl.vendor.json
 *
 * For programmatic control, use the API:
 *   import { build } from 'mini-react-repl/vendor-builder';
 *
 * @internal
 */

import { build } from './build.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

type Args = {
  entry: string;
  out: string;
  nodeEnv: 'development' | 'production';
  types: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { nodeEnv: 'development', types: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out' || a === '-o') {
      args.out = argv[++i];
    } else if (a === '--prod') {
      args.nodeEnv = 'production';
    } else if (a === '--no-types') {
      args.types = false;
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
      'Missing entry file. Usage: repl-vendor-build <entry.ts> --out <bundle.json>\n' +
        '       Run with --help for details.',
    );
  }
  if (!args.out) throw new Error('--out is required');
  return args as Args;
}

function printHelp(): void {
  process.stdout.write(`repl-vendor-build — produce a vendor bundle for mini-react-repl

Usage:
  repl-vendor-build <entry-file> --out <bundle.json> [options]

The entry file is a TypeScript or JavaScript module that declares the bundle
shape via standard ESM \`import * as X from '<spec>'; export { X as '<key>' }\`.
Re-export the shipped iframe-runtime core by adding
\`export * from 'mini-react-repl/vendor-base'\` at the top.

Required:
  -o, --out <file>         path for the serialized bundle JSON
                           (typically alongside your source so you can import it)

Optional:
      --no-types           skip the .d.ts walk (smaller output, no editor type info)
      --prod               use NODE_ENV=production (default development)
  -h, --help               show this help

Output (single file):
  { importMap: { imports: { 'react': 'data:text/javascript;base64,...', ... } },
    types: { libs: [...] } }   // present unless --no-types

Consumer:
  import vendor from './vendor/repl.vendor.json';
  <Repl vendor={vendor} ... />

  // Code-split: bundlers split the JSON when imported dynamically.
  <Repl vendor={import('./vendor/repl.vendor.json')} ... />

Example vendor.ts:
  export * from 'mini-react-repl/vendor-base';

  import * as zod from 'zod';
  import * as lodash from 'lodash-es';   // alias source: iframe imports 'lodash'
  export {
    zod,
    lodash,
  };

Example:
  repl-vendor-build vendor.ts --out src/vendor/repl.vendor.json
`);
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

async function main(): Promise<void> {
  await ensureEsbuildInstalled();
  const args = parseArgs(process.argv.slice(2));
  const bundle = await build({
    entry: args.entry,
    nodeEnv: args.nodeEnv,
    types: args.types ? 'embed' : 'omit',
  });

  const bundlePath = resolve(process.cwd(), args.out);
  await mkdir(dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  process.stderr.write(`✓ wrote ${bundlePath}\n`);
}

main().catch((err) => {
  process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
