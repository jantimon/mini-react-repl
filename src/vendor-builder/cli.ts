#!/usr/bin/env node
/**
 * `repl-vendor-build` CLI.
 *
 *   npx repl-vendor-build \
 *     --packages react,react-dom/client,date-fns \
 *     --out public/vendor \
 *     --format hosted
 *
 * Prints the resulting import map to stdout.
 *
 * @internal
 */

import { build } from './build.ts';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Args = {
  packages: string[];
  format: 'hosted' | 'inline';
  out: string | undefined;
  baseUrl: string | undefined;
  nodeEnv: 'development' | 'production';
  importMapOut: string | undefined;
  types: 'embed' | 'omit';
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {
    format: 'hosted',
    nodeEnv: 'development',
    types: 'omit',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--packages' || a === '-p') {
      args.packages = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === '--out' || a === '-o') {
      args.out = argv[++i];
    } else if (a === '--format' || a === '-f') {
      const v = argv[++i];
      if (v !== 'hosted' && v !== 'inline') {
        throw new Error(`--format must be 'hosted' or 'inline' (got '${v}')`);
      }
      args.format = v;
    } else if (a === '--base-url') {
      args.baseUrl = argv[++i];
    } else if (a === '--prod') {
      args.nodeEnv = 'production';
    } else if (a === '--import-map-out') {
      args.importMapOut = argv[++i];
    } else if (a === '--types') {
      const v = argv[++i];
      if (v !== 'embed' && v !== 'omit') {
        throw new Error(`--types must be 'embed' or 'omit' (got '${v}')`);
      }
      args.types = v;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!args.packages?.length) {
    throw new Error('--packages is required');
  }
  if (args.format === 'hosted' && !args.out) {
    throw new Error('--out is required when --format hosted');
  }
  return args as Args;
}

function printHelp(): void {
  process.stdout.write(`repl-vendor-build — produce a vendor bundle for mini-react-repl

Usage:
  repl-vendor-build --packages <list> [options]

Options:
  -p, --packages <list>     comma-separated bare specifiers (required)
  -o, --out <dir>           output directory (required for --format hosted)
  -f, --format <fmt>        'hosted' (default) or 'inline'
      --base-url <url>      public URL base for hosted format (default '/vendor')
      --prod                use NODE_ENV=production (default development)
      --types <mode>        'embed' or 'omit' (default). When 'embed', also
                            collect .d.ts for each package and emit them
                            as vendor.types (and types.json for hosted)
      --import-map-out <p>  also write the import map JSON to this path
  -h, --help                show this help

Examples:
  repl-vendor-build -p react,react-dom/client,date-fns -o public/vendor
  repl-vendor-build -p react,react-dom/client -f inline --types embed
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
  const result = await build({
    packages: args.packages,
    format: args.format,
    ...(args.out ? { outDir: args.out } : {}),
    ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
    nodeEnv: args.nodeEnv,
    types: args.types,
  });

  const json = JSON.stringify(result.importMap, null, 2);
  if (args.importMapOut) {
    await writeFile(resolve(process.cwd(), args.importMapOut), json + '\n', 'utf8');
    process.stderr.write(`✓ wrote ${args.importMapOut}\n`);
  } else {
    process.stdout.write(json + '\n');
  }
}

main().catch((err) => {
  process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
