#!/usr/bin/env node
/**
 * `repl-vendor-build` CLI — hosted-format vendor bundles only. The
 * programmatic API (`mini-react-repl/vendor-builder`) covers inline / data:
 * URL builds and any other custom output shape.
 *
 *   npx repl-vendor-build vendor.ts \
 *     --out public/vendor \
 *     --bundle-out src/vendor/repl.vendor.json
 *
 * @internal
 */

import { build } from './build.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

type Args = {
  entry: string;
  out: string;
  bundleOut: string;
  baseUrl: string | undefined;
  nodeEnv: 'development' | 'production';
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { nodeEnv: 'development' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out' || a === '-o') {
      args.out = argv[++i];
    } else if (a === '--bundle-out' || a === '-b') {
      args.bundleOut = argv[++i];
    } else if (a === '--base-url') {
      args.baseUrl = argv[++i];
    } else if (a === '--prod') {
      args.nodeEnv = 'production';
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
      'Missing entry file. Usage: repl-vendor-build <entry.ts> --out <dir> --bundle-out <file>\n' +
        '       Run with --help for details.',
    );
  }
  if (!args.out) throw new Error('--out is required');
  if (!args.bundleOut) throw new Error('--bundle-out is required');
  return args as Args;
}

/**
 * If the consumer pointed `--out` at something under `public/`, the chunks
 * will be served at the path AFTER that segment. e.g. `public/vendor` →
 * `/vendor`, `apps/web/public/static/repl` → `/static/repl`. Returning
 * `undefined` falls back to the build's default `/vendor`.
 */
function inferBaseUrl(outDir: string): string | undefined {
  const normalized = outDir.replace(/\\/g, '/');
  const m = normalized.match(/(?:^|\/)public\/(.+?)\/*$/);
  return m ? '/' + m[1] : undefined;
}

function printHelp(): void {
  process.stdout.write(`repl-vendor-build — produce a vendor bundle for mini-react-repl

Usage:
  repl-vendor-build <entry-file> --out <dir> --bundle-out <file> [options]

The entry file is a TypeScript or JavaScript module that declares the bundle
shape via standard ESM \`import * as X from '<spec>'; export { X as '<key>' }\`.
Re-export the shipped iframe-runtime core by adding
\`export * from 'mini-react-repl/vendor-base'\` at the top.

Required:
  -o, --out <dir>           directory for JS chunks + repl.types.json
                            (must be web-served at base-url)
  -b, --bundle-out <file>   path for the serialized import-map JSON
                            (typically alongside your source so you can import it)

Optional:
      --base-url <url>      public URL base for the JS chunks. Inferred from
                            --out when it contains 'public/' (e.g. public/vendor
                            → /vendor); otherwise defaults to /vendor.
      --prod                use NODE_ENV=production (default development)
  -h, --help                show this help

Outputs:
  --out/<spec>.<hash>.js    one ESM chunk per package
  --out/repl.types.json     bundled .d.ts payload (fetched at runtime)
  --bundle-out              { importMap, typesUrl } JSON (bundler-imported)

Consumer:
  // The bundle JSON embeds a typesUrl pointer, so the library fetches and
  // registers the .d.ts payload itself — no consumer-side fetch needed.
  import vendor from './vendor/repl.vendor.json';
  <Repl vendor={vendor} ... />

  // Code-split version is just as concise:
  <Repl vendor={import('./vendor/repl.vendor.json')} ... />

For inline (data: URL) builds or other custom output shapes, use the
programmatic API: import { build } from 'mini-react-repl/vendor-builder'.

Example vendor.ts:
  export * from 'mini-react-repl/vendor-base';

  import * as zod from 'zod';
  import * as lodash from 'lodash-es';   // alias source: iframe imports 'lodash'
  export {
    zod,
    lodash,
  };

Example:
  repl-vendor-build vendor.ts --out public/vendor --bundle-out src/vendor/repl.vendor.json
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
  const baseUrl = args.baseUrl ?? inferBaseUrl(args.out);
  const { types, ...importMapBundle } = await build({
    entry: args.entry,
    format: 'hosted',
    outDir: args.out,
    ...(baseUrl ? { baseUrl } : {}),
    nodeEnv: args.nodeEnv,
    types: 'embed',
  });

  // Write types as their own asset alongside the JS chunks. The bundler-
  // imported `--bundle-out` JSON stays small (just the import map + a
  // pointer to the types URL); the multi-MB `.d.ts` payload is fetched at
  // runtime in parallel and registered automatically by `<ReplProvider/>`.
  if (types) {
    const typesPath = resolve(process.cwd(), join(args.out, 'repl.types.json'));
    await mkdir(dirname(typesPath), { recursive: true });
    await writeFile(typesPath, JSON.stringify(types) + '\n', 'utf8');
    process.stderr.write(`✓ wrote ${typesPath}\n`);

    // Mirror build.ts's default — `baseUrl ?? '/vendor'`. Same join rule
    // as the JS chunks (trim trailing slashes; single separator).
    const effectiveBaseUrl = (baseUrl ?? '/vendor').replace(/\/+$/, '');
    importMapBundle.typesUrl = `${effectiveBaseUrl}/repl.types.json`;
  }

  const bundlePath = resolve(process.cwd(), args.bundleOut);
  await mkdir(dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, JSON.stringify(importMapBundle) + '\n', 'utf8');
  process.stderr.write(`✓ wrote ${bundlePath}\n`);
}

main().catch((err) => {
  process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
