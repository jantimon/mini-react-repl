/**
 * Programmatic vendor-bundle builder.
 *
 * Produces ESM modules for a list of bare specifiers using esbuild, plus a
 * standard import map mapping each specifier to the produced output (or to a
 * `data:` URL when `format: 'inline'`). With `types: 'embed'`, also collects
 * the matching `.d.ts` graph into `vendor.types` so editors (e.g. Monaco)
 * can light up squiggles and hover signatures for the vendor packages.
 *
 * Designed to run in Node, not in the browser (esbuild and the type walker
 * both require it).
 *
 * @example Hosted output, no types
 * ```ts
 * import { build } from 'mini-react-repl/vendor-builder'
 * const vendor = await build({
 *   packages: ['react', 'react-dom/client', 'date-fns'],
 *   format: 'hosted',
 *   outDir: 'public/vendor',
 * })
 * // vendor.importMap → { imports: { 'react': '/vendor/react.js', ... } }
 * // files written to ./public/vendor/*.js
 * ```
 *
 * @example Inline output with types (works under iframe srcdoc)
 * ```ts
 * const vendor = await build({
 *   packages: ['react', 'react-dom/client', 'date-fns'],
 *   format: 'inline',
 *   types: 'embed',
 * })
 * // vendor.importMap → { imports: { 'react': 'data:text/javascript;base64,...' } }
 * // vendor.types     → { libs: [{ path: 'file:///node_modules/react/index.d.ts', content: '...' }, ...] }
 * ```
 *
 * @public
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { ImportMap, TypeBundle, VendorBundle } from '../types.ts';

export type BuildOptions = {
  /**
   * Bare specifiers to bundle. Can include subpaths (`'react-dom/client'`,
   * `'react/jsx-runtime'`).
   */
  packages: string[];
  /**
   * `'hosted'` writes one file per package to `outDir` and returns an import
   * map with relative URLs (rooted at `baseUrl`, default `/vendor`).
   * `'inline'` returns an import map with `data:` URLs and writes nothing.
   */
  format: 'hosted' | 'inline';
  /** Required when `format === 'hosted'`. */
  outDir?: string;
  /** Public URL base for the hosted format. @defaultValue `'/vendor'` */
  baseUrl?: string;
  /**
   * Whether to set `process.env.NODE_ENV` to `'development'`. React requires
   * one of `'development'` or `'production'` to be defined.
   * @defaultValue `'development'`
   */
  nodeEnv?: 'development' | 'production';
  /** Working directory for module resolution. @defaultValue `process.cwd()` */
  cwd?: string;
  /**
   * `'embed'` collects `.d.ts` files for each package (own types or
   * `@types/<name>` fallback) and returns them in `vendor.types`. Editors
   * that consume types — Monaco via `mini-react-repl/editor-monaco` — register
   * them with the in-browser TypeScript service.
   *
   * For `format: 'hosted'`, a `types.json` file is also written next to the
   * JS modules.
   *
   * @defaultValue `'omit'`
   */
  types?: 'embed' | 'omit';
};

/** Build a vendor bundle. Returns the {@link VendorBundle} the consumer passes to `<Repl/>`. */
export async function build(options: BuildOptions): Promise<VendorBundle> {
  const baseUrl = options.baseUrl ?? '/vendor';
  const nodeEnv = options.nodeEnv ?? 'development';
  const cwd = options.cwd ?? process.cwd();
  const wantTypes = options.types === 'embed';

  if (options.format === 'hosted' && !options.outDir) {
    throw new Error("build({ format: 'hosted' }) requires outDir");
  }

  const importMap: ImportMap = { imports: {} };
  const types: TypeBundle | undefined = wantTypes
    ? await collectTypes(options.packages, cwd)
    : undefined;

  if (options.format === 'hosted') {
    const outDir = resolve(cwd, options.outDir!);
    await mkdir(outDir, { recursive: true });

    for (const pkg of options.packages) {
      const code = await bundlePackage(pkg, nodeEnv, cwd);
      const safe = pkg.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
      const hash = shortHash(code);
      const filename = `${safe}.${hash}.js`;
      await writeFile(join(outDir, filename), code, 'utf8');
      importMap.imports[pkg] = `${baseUrl.replace(/\/+$/, '')}/${filename}`;
    }
    if (types) {
      await writeFile(join(outDir, 'types.json'), JSON.stringify(types) + '\n', 'utf8');
    }
    return types ? { importMap, types } : { importMap };
  }

  // inline
  for (const pkg of options.packages) {
    const code = await bundlePackage(pkg, nodeEnv, cwd);
    const dataUrl = toDataUrl(code);
    importMap.imports[pkg] = dataUrl;
  }
  return types ? { importMap, types } : { importMap };
}

/**
 * esbuild is an optional peer dependency. Defer the import so this module
 * can be loaded (e.g. for type-only users) without esbuild installed, and
 * so the failure mode when it's missing is a friendly install hint rather
 * than a raw ESM resolution error.
 */
let esbuildPromise: Promise<typeof import('esbuild')> | null = null;
async function loadEsbuild(): Promise<typeof import('esbuild')> {
  if (!esbuildPromise) {
    esbuildPromise = import('esbuild').catch((err) => {
      esbuildPromise = null;
      const orig = err instanceof Error ? err.message : String(err);
      throw new Error(
        "mini-react-repl/vendor-builder requires 'esbuild' (optional peer dependency). " +
          'Install it as a dev dep: `npm i -D esbuild` (or `pnpm add -D esbuild`). ' +
          `Original error: ${orig}`,
      );
    });
  }
  return esbuildPromise;
}

async function bundlePackage(
  specifier: string,
  nodeEnv: 'development' | 'production',
  cwd: string,
): Promise<string> {
  const esbuild = await loadEsbuild();
  const result = await esbuild.build({
    stdin: {
      contents: `export * from ${JSON.stringify(specifier)};
${needsDefaultReexport(specifier) ? `export { default } from ${JSON.stringify(specifier)};` : ''}`,
      resolveDir: cwd,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    write: false,
    minify: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
    },
    legalComments: 'none',
    logLevel: 'silent',
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error(`esbuild produced no output for '${specifier}'`);
  return output;
}

/**
 * Whether to add `export { default } from '<specifier>'`. Some packages don't
 * have a default export, in which case esbuild errors. We add the re-export
 * by default; for packages without one, the consumer can pre-process the list.
 */
function needsDefaultReexport(specifier: string): boolean {
  // react, react-dom, lodash-es, date-fns ship default exports we want to
  // surface. for jsx-runtime / dev-runtime there is no default and re-exporting
  // would error.
  if (specifier.endsWith('/jsx-runtime') || specifier.endsWith('/jsx-dev-runtime')) {
    return false;
  }
  return true;
}

function toDataUrl(code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const base64 = Buffer.from(code, 'utf8').toString('base64');
  return `data:text/javascript;base64,${base64}`;
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}

// ─── type-bundle collection ──────────────────────────────────────────────

async function collectTypes(packages: string[], cwd: string): Promise<TypeBundle> {
  const rootReq = createRequire(pathToFileURL(join(cwd, '__entry__.js')).href);
  const seen = new Set<string>();
  const libs: Array<{ path: string; content: string }> = [];

  for (const spec of packages) {
    await walkSpec(spec, rootReq, seen, libs);
  }
  return { libs };
}

type ResolvedTypes = { absPath: string; ownerPkg: string; ownerRoot: string };

async function walkSpec(
  spec: string,
  req: NodeRequire,
  seen: Set<string>,
  libs: Array<{ path: string; content: string }>,
): Promise<void> {
  const entry = await resolveTypesEntry(spec, req);
  if (!entry) {
    process.stderr.write(`[vendor-builder] no .d.ts found for '${spec}', skipping\n`);
    return;
  }
  await walkFile(entry.absPath, entry.ownerPkg, entry.ownerRoot, seen, libs);
}

function parseSpecifier(spec: string): { pkgName: string; subpath: string | null } {
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

function typesPackageNameFor(pkgName: string): string {
  if (pkgName.startsWith('@')) {
    return `@types/${pkgName.slice(1).replace('/', '__')}`;
  }
  return `@types/${pkgName}`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function resolveTypesEntry(spec: string, req: NodeRequire): Promise<ResolvedTypes | null> {
  const { pkgName, subpath } = parseSpecifier(spec);

  // 1. Try the package's own types.
  const own = await tryResolvePkg(pkgName, subpath, pkgName, req);
  if (own) return own;

  // 2. Fall back to @types/<name>.
  const typesPkg = typesPackageNameFor(pkgName);
  const fromTypes = await tryResolvePkg(typesPkg, subpath, pkgName, req);
  if (fromTypes) return fromTypes;

  return null;
}

async function tryResolvePkg(
  pkgToResolve: string,
  subpath: string | null,
  ownerPkg: string,
  req: NodeRequire,
): Promise<ResolvedTypes | null> {
  let pjPath: string;
  try {
    pjPath = req.resolve(`${pkgToResolve}/package.json`);
  } catch {
    return null;
  }
  const pjDir = dirname(pjPath);
  const pj = JSON.parse(await readFile(pjPath, 'utf8')) as {
    types?: string;
    typings?: string;
  };

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

async function walkFile(
  absPath: string,
  ownerPkg: string,
  ownerRoot: string,
  seen: Set<string>,
  libs: Array<{ path: string; content: string }>,
): Promise<void> {
  if (seen.has(absPath)) return;
  seen.add(absPath);

  const content = await readFile(absPath, 'utf8');
  const rel = relative(ownerRoot, absPath).split('\\').join('/');
  const uri = `file:///node_modules/${ownerPkg}/${rel}`;
  libs.push({ path: uri, content });

  const stripped = stripComments(content);
  const imports = extractImports(stripped);
  const refPaths = extractTripleSlashRefs(content);

  for (const ref of refPaths) {
    // /// <reference path="..." /> resolves relative to the current file.
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
      // .d.ts files often reference companions via `./x.js` (TS convention
      // under "moduleResolution": "node16"/"bundler"); the actual file is
      // `./x.d.ts`. Strip JS-flavored extensions before probing.
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
      // Bare specifier — resolve as a fresh package; gives it its own owner.
      await walkSpec(imp, localReq, seen, libs);
    }
  }
}

const RE_FROM = /\b(?:from|import)\s*['"]([^'"\n]+)['"]/g;
const RE_DYN_IMPORT = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const RE_REF = /\/\/\/\s*<reference\s+(?:path|types)\s*=\s*['"]([^'"\n]+)['"]\s*\/?>/g;

function extractImports(source: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  RE_FROM.lastIndex = 0;
  while ((m = RE_FROM.exec(source)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  RE_DYN_IMPORT.lastIndex = 0;
  while ((m = RE_DYN_IMPORT.exec(source)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

function extractTripleSlashRefs(source: string): string[] {
  const out: string[] = [];
  RE_REF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_REF.exec(source)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Drop block + line comments while keeping triple-slash references intact.
 * Avoids false-positive imports like `from 'react'` mentioned inside JSDoc.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let inString: '"' | "'" | '`' | null = null;
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
      inString = ch as '"' | "'" | '`';
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      // Keep triple-slash references — they're already extracted from the
      // raw source elsewhere and we want them not to leak as `from '...'`
      // matches. Drop the line but preserve newline so line numbers stay.
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
