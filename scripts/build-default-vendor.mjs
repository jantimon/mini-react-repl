#!/usr/bin/env node
/**
 * Builds the default vendor bundle by invoking the same `repl-vendor-build`
 * pipeline end users get. Outputs into `src/vendor-default/`:
 *
 *   src/vendor-default/index.ts          (exports `defaultVendor: VendorBundle`)
 *   src/vendor-default/import-map.json
 *   src/vendor-default/types.json
 *
 * Subsequent `tsup` build picks up `index.ts`; `splitting: true` keeps the
 * two JSON payloads in their own code-split chunks so consumer bundlers can
 * defer the import-map download until `<Repl/>` is actually rendered, and
 * the types download until Monaco mounts.
 *
 * The single difference from the CLI's default behaviour: the exported
 * identifier is `defaultVendor` (not `customVendor`). Same template, same
 * lazy-thunk shape, one path to maintain.
 *
 * Imports the `.ts` source directly: requires Node ≥ 22.6 (with
 * --experimental-strip-types) or Node ≥ 23 (default-on).
 */

import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { runBuild } from '../src/vendor-builder/cli.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'src/vendor-default');

// Run relative to the repo root so module resolution of `react`, `dayjs`,
// etc. picks up the workspace's own node_modules. runBuild() resolves
// `entry` and `outDir` against process.cwd(), so we chdir for the duration.
const prevCwd = process.cwd();
process.chdir(root);
try {
  await runBuild({
    entry: relative(root, resolve(root, 'src/default-vendor.ts')),
    outDir: relative(root, outDir),
    nodeEnv: 'development',
    types: true,
    exportName: 'defaultVendor',
  });
} finally {
  process.chdir(prevCwd);
}

const importMap = JSON.parse(await readFile(resolve(outDir, 'import-map.json'), 'utf8'));
let totalBytes = 0;
for (const [spec, url] of Object.entries(importMap.imports)) {
  const code = Buffer.from(url.replace(/^data:text\/javascript;base64,/, ''), 'base64').toString(
    'utf8',
  );
  totalBytes += code.length;
  process.stdout.write(`  ${spec.padEnd(28)} ${(code.length / 1024).toFixed(1).padStart(7)} kB\n`);
}

const typesPath = resolve(outDir, 'types.json');
let typesBytes = 0;
let typeFiles = 0;
try {
  await stat(typesPath);
  const types = JSON.parse(await readFile(typesPath, 'utf8'));
  const entries = Object.values(types.libs);
  typesBytes = entries.reduce((n, content) => n + content.length, 0);
  typeFiles = entries.length;
} catch {
  // --no-types path: no summary line.
}

process.stdout.write(
  `\n  ${typeFiles} .d.ts files, ${(typesBytes / 1024).toFixed(1)} kB total\n\n`,
);
console.log(
  `✓ default vendor written: ${(totalBytes / 1024).toFixed(1)} kB JS (import-map.json), ${(typesBytes / 1024).toFixed(1)} kB types (types.json)`,
);
