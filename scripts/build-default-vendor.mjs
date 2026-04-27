#!/usr/bin/env node
/**
 * Builds the default vendor bundle inlined as base64 data URLs, plus the
 * paired `.d.ts` payload (`vendor.types`) for editors that consume types.
 *
 * Output: `src/vendor-default/data.ts` (re-generated each run; gitignored).
 * Subsequent `tsup` build reads it and bakes it into the dist subpath.
 */

import { build } from 'esbuild';
import { writeFile, mkdir, mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Each package's external set lists OTHER vendor entries it should NOT
// bundle in (those resolve at runtime via the import map). Without this
// every dependent of `react` gets its own copy → "more than one copy of
// React" hook errors.
const PACKAGES = [
  { specifier: 'react', defaultExport: true, external: [] },
  { specifier: 'react-dom', defaultExport: true, external: ['react'] },
  { specifier: 'react-dom/client', defaultExport: false, external: ['react'] },
  { specifier: 'react/jsx-runtime', defaultExport: false, external: ['react'] },
  { specifier: 'react/jsx-dev-runtime', defaultExport: false, external: ['react'] },
  { specifier: 'react-refresh/runtime', defaultExport: true, external: [] },
  { specifier: 'date-fns', defaultExport: false, external: [] },
  { specifier: 'dayjs', defaultExport: true, external: [] },
  { specifier: 'lodash-es', defaultExport: false, external: [] },
];

// Specifiers we want types for. `react-refresh/runtime` is excluded
// because it's used internally by the iframe runtime, never by user code,
// and the types are not interesting in the editor.
const TYPE_PACKAGES = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'date-fns',
  'dayjs',
  'lodash-es',
];

const tmp = await mkdtemp(join(tmpdir(), 'repl-vendor-'));

async function bundle(specifier, defaultExport, external = []) {
  // Discover the actual named exports at build time. esbuild's `export *`
  // from CJS modules drops the re-exports in the output, so we generate
  // explicit `export const X = M.X` lines instead — those esbuild surfaces
  // correctly because they're statically named.
  const names = await discoverExports(specifier);

  const safe = specifier.replace(/[^a-z0-9]+/gi, '_');
  const entry = join(tmp, `${safe}.js`);
  const lines = [
    `import * as __M from ${JSON.stringify(specifier)};`,
    ...names.map((n) => `export const ${safeIdent(n)} = __M[${JSON.stringify(n)}];`),
  ];
  if (defaultExport) lines.push(`export default __M.default ?? __M;`);
  await writeFile(entry, lines.join('\n') + '\n', 'utf8');

  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    write: false,
    minify: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    legalComments: 'none',
    logLevel: 'silent',
    nodePaths: [join(root, 'node_modules')],
    absWorkingDir: root,
    // esbuild's `external` matches subpaths too (`external: ['react']`
    // also externalizes `react/jsx-runtime`), which would create a self-
    // import in subpath bundles. Use a plugin for exact matches only.
    plugins:
      external.length > 0
        ? [
            {
              name: 'exact-external',
              setup(b) {
                const set = new Set(external);
                b.onResolve({ filter: /.*/ }, (args) => {
                  if (set.has(args.path)) return { path: args.path, external: true };
                  return null;
                });
              },
            },
          ]
        : [],
    // esbuild's CJS-to-ESM interop emits `__require("react")` for nested
    // require() calls into externalized packages. The browser has no
    // `require`. We inject ESM imports for each external + a global
    // `require` shim that dispatches to the imported namespace objects.
    banner:
      external.length > 0
        ? {
            js:
              external
                .map((ext, i) => `import * as __ext_${i} from ${JSON.stringify(ext)};`)
                .join('\n') +
              '\n' +
              `if (typeof globalThis.require === 'undefined') globalThis.require = function(id){\n` +
              external
                .map(
                  (ext, i) =>
                    `  if (id === ${JSON.stringify(ext)}) return __ext_${i}.default ?? __ext_${i};`,
                )
                .join('\n') +
              `\n  throw new Error('Cannot require: ' + id);\n};\n`,
          }
        : undefined,
  });
  return result.outputFiles[0].text;
}

async function discoverExports(specifier) {
  // Need to resolve from the workspace root so subpath-only imports work
  // (e.g. react-dom/client). Use Node's experimental `import()` with a
  // workspace-rooted path resolved via a temp anchor.
  const mod = await import(specifier);
  return Object.keys(mod).filter((k) => k !== 'default' && isValidExportName(k));
}

const RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

function isValidExportName(name) {
  if (RESERVED.has(name)) return false;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function safeIdent(name) {
  return name;
}

// ─── type-bundle collection ──────────────────────────────────────────────

const rootReq = createRequire(pathToFileURL(join(root, '__entry__.js')).href);

async function collectTypes(specifiers) {
  const seen = new Set();
  const libs = [];
  for (const spec of specifiers) {
    await walkSpec(spec, rootReq, seen, libs);
  }
  return { libs };
}

function parseSpecifier(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    if (parts.length < 2) return { pkgName: spec, subpath: null };
    const pkgName = `${parts[0]}/${parts[1]}`;
    const subpath = parts.length > 2 ? parts.slice(2).join('/') : null;
    return { pkgName, subpath };
  }
  const idx = spec.indexOf('/');
  if (idx === -1) return { pkgName: spec, subpath: null };
  return { pkgName: spec.slice(0, idx), subpath: spec.slice(idx + 1) };
}

function typesPackageNameFor(pkgName) {
  if (pkgName.startsWith('@')) {
    return `@types/${pkgName.slice(1).replace('/', '__')}`;
  }
  return `@types/${pkgName}`;
}

async function fileExists(p) {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function tryResolvePkg(pkgToResolve, subpath, ownerPkg, req) {
  let pjPath;
  try {
    pjPath = req.resolve(`${pkgToResolve}/package.json`);
  } catch {
    return null;
  }
  const pjDir = dirname(pjPath);
  const pj = JSON.parse(await readFile(pjPath, 'utf8'));

  if (subpath) {
    const candidates = [
      join(pjDir, `${subpath}.d.ts`),
      join(pjDir, subpath, 'index.d.ts'),
      join(pjDir, `${subpath}.d.mts`),
    ];
    for (const c of candidates) {
      if (await fileExists(c)) return { absPath: c, ownerPkg, ownerRoot: pjDir };
    }
    return null;
  }
  const typesField = pj.types ?? pj.typings;
  if (typesField) {
    const candidate = resolve(pjDir, typesField);
    if (await fileExists(candidate)) return { absPath: candidate, ownerPkg, ownerRoot: pjDir };
  }
  const fallback = join(pjDir, 'index.d.ts');
  if (await fileExists(fallback)) return { absPath: fallback, ownerPkg, ownerRoot: pjDir };
  return null;
}

async function resolveTypesEntry(spec, req) {
  const { pkgName, subpath } = parseSpecifier(spec);
  const own = await tryResolvePkg(pkgName, subpath, pkgName, req);
  if (own) return own;
  const typesPkg = typesPackageNameFor(pkgName);
  const fromTypes = await tryResolvePkg(typesPkg, subpath, pkgName, req);
  if (fromTypes) return fromTypes;
  return null;
}

async function walkSpec(spec, req, seen, libs) {
  const entry = await resolveTypesEntry(spec, req);
  if (!entry) {
    process.stderr.write(`[types] no .d.ts for '${spec}', skipping\n`);
    return;
  }
  await walkFile(entry.absPath, entry.ownerPkg, entry.ownerRoot, seen, libs);
}

async function walkFile(absPath, ownerPkg, ownerRoot, seen, libs) {
  if (seen.has(absPath)) return;
  seen.add(absPath);
  const content = await readFile(absPath, 'utf8');
  const rel = relative(ownerRoot, absPath).split('\\').join('/');
  const uri = `file:///node_modules/${ownerPkg}/${rel}`;
  libs.push({ path: uri, content });

  const stripped = stripComments(content);
  const imports = extractImports(stripped);
  const refs = extractTripleSlashRefs(content);

  for (const ref of refs) {
    const dir = dirname(absPath);
    const candidates = ref.endsWith('.d.ts')
      ? [resolve(dir, ref)]
      : [resolve(dir, `${ref}.d.ts`), resolve(dir, ref, 'index.d.ts'), resolve(dir, ref)];
    for (const c of candidates) {
      if (await fileExists(c)) {
        await walkFile(c, ownerPkg, ownerRoot, seen, libs);
        break;
      }
    }
  }

  // Re-root resolution at this file's location so pnpm-style transitive
  // dependencies (e.g. @types/react → csstype) are reachable.
  const localReq = createRequire(pathToFileURL(absPath).href);

  for (const imp of imports) {
    if (imp.startsWith('./') || imp.startsWith('../')) {
      const dir = dirname(absPath);
      // .d.ts files often reference companions via `./x.js`; the actual
      // file is `./x.d.ts`. Strip JS-flavored extensions before probing.
      const base = imp.replace(/\.(?:js|mjs|cjs)$/, '');
      const candidates = [
        resolve(dir, `${base}.d.ts`),
        resolve(dir, `${base}.d.mts`),
        resolve(dir, base, 'index.d.ts'),
        resolve(dir, imp),
      ];
      for (const c of candidates) {
        if ((c.endsWith('.d.ts') || c.endsWith('.d.mts')) && (await fileExists(c))) {
          await walkFile(c, ownerPkg, ownerRoot, seen, libs);
          break;
        }
      }
    } else {
      await walkSpec(imp, localReq, seen, libs);
    }
  }
}

const RE_FROM = /\b(?:from|import)\s*['"]([^'"\n]+)['"]/g;
const RE_DYN_IMPORT = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const RE_REF = /\/\/\/\s*<reference\s+(?:path|types)\s*=\s*['"]([^'"\n]+)['"]\s*\/?>/g;

function extractImports(source) {
  const out = new Set();
  let m;
  RE_FROM.lastIndex = 0;
  while ((m = RE_FROM.exec(source)) !== null) out.add(m[1]);
  RE_DYN_IMPORT.lastIndex = 0;
  while ((m = RE_DYN_IMPORT.exec(source)) !== null) out.add(m[1]);
  return [...out];
}

function extractTripleSlashRefs(source) {
  const out = [];
  RE_REF.lastIndex = 0;
  let m;
  while ((m = RE_REF.exec(source)) !== null) out.push(m[1]);
  return out;
}

function stripComments(source) {
  let out = '';
  let i = 0;
  let inString = null;
  let inLine = false;
  let inBlock = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        out += ch + (next ?? '');
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ─── main ────────────────────────────────────────────────────────────────

const imports = {};
let totalBytes = 0;
for (const { specifier, defaultExport, external } of PACKAGES) {
  const code = await bundle(specifier, defaultExport, external);
  const b64 = Buffer.from(code, 'utf8').toString('base64');
  const dataUrl = `data:text/javascript;base64,${b64}`;
  imports[specifier] = dataUrl;
  totalBytes += code.length;
  process.stdout.write(
    `  ${specifier.padEnd(28)} ${(code.length / 1024).toFixed(1).padStart(7)} kB\n`,
  );
}

process.stdout.write(`\n  collecting .d.ts...\n`);
const types = await collectTypes(TYPE_PACKAGES);
const typesBytes = types.libs.reduce((n, l) => n + l.content.length, 0);
process.stdout.write(
  `  ${types.libs.length} .d.ts files, ${(typesBytes / 1024).toFixed(1)} kB total\n\n`,
);

const out = `// AUTO-GENERATED by scripts/build-default-vendor.mjs — do not edit.
/* eslint-disable */
import type { VendorBundle } from '../types.ts'

export const DEFAULT_VENDOR: VendorBundle = {
  importMap: ${JSON.stringify({ imports }, null, 2)},
  types: ${JSON.stringify(types)},
}
`;

const outPath = resolve(root, 'src/vendor-default/data.ts');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, out, 'utf8');

console.log(
  `✓ default vendor written to ${outPath} (${(totalBytes / 1024).toFixed(1)} kB JS, ${(typesBytes / 1024).toFixed(1)} kB types)`,
);

await rm(tmp, { recursive: true, force: true });
