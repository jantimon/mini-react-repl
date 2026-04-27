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

/**
 * Specifiers the iframe runtime hard-imports through the import map. They
 * must always be in the produced vendor or the preview never boots:
 *
 * - `react`, `react-dom/client`, `react-refresh/runtime` — imported by the
 *   in-iframe runtime and preamble (see `src/runtime/preamble.ts`,
 *   `src/runtime/runtime.ts`).
 * - `react-dom` — pulled in transitively by `react-dom/client`'s bundle.
 * - `react/jsx-runtime` and `react/jsx-dev-runtime` — every JSX file the
 *   SWC transform produces imports one of them.
 */
const REQUIRED_CORE = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-refresh/runtime',
] as const;

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
  /**
   * Specifiers that should NOT be bundled into other packages — they resolve
   * at runtime via the import map. Each entry must also appear in `packages`
   * (or be auto-included via {@link includeRequiredCore}).
   *
   * When omitted, the effective external set is `packages` PLUS the
   * auto-included required core. That's the default users almost always
   * want: bundling `react,react-dom,recharts` in one go produces three
   * modules that share a single React copy at runtime, not three private
   * React copies — and the auto-included `react`, `react-dom/client`, etc.
   * are externalized for the same reason.
   *
   * Subpaths of the same physical package (e.g. `react-dom` and
   * `react-dom/client`) are never cross-externalized regardless: their
   * shared internal state must stay co-located in one bundle.
   */
  external?: string[];
  /**
   * Whether to auto-include the core specifiers the iframe runtime requires
   * (`react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`,
   * `react/jsx-dev-runtime`, `react-refresh/runtime`). Missing entries are
   * prepended to `packages` and bundled with the same external rules.
   *
   * Set to `false` only if you're slotting these in from a different vendor.
   *
   * @defaultValue `true`
   */
  includeRequiredCore?: boolean;
  /**
   * Override the specifier list used for `.d.ts` collection when
   * `types: 'embed'`. Defaults to the same list as `packages` (after
   * required-core auto-include).
   *
   * Useful when an entry has no public-facing types you care about — e.g.
   * `react-refresh/runtime` is consumed only by the iframe runtime, never
   * by user code.
   */
  typesPackages?: string[];
};

/** Build a vendor bundle. Returns the {@link VendorBundle} the consumer passes to `<Repl/>`. */
export async function build(options: BuildOptions): Promise<VendorBundle> {
  const baseUrl = options.baseUrl ?? '/vendor';
  const nodeEnv = options.nodeEnv ?? 'development';
  const cwd = options.cwd ?? process.cwd();
  const wantTypes = options.types === 'embed';
  const includeCore = options.includeRequiredCore ?? true;

  if (options.format === 'hosted' && !options.outDir) {
    throw new Error("build({ format: 'hosted' }) requires outDir");
  }

  const packages = withRequiredCore(options.packages, includeCore);
  const externals = options.external ?? packages;

  const importMap: ImportMap = { imports: {} };
  const types: TypeBundle | undefined = wantTypes
    ? await collectTypes(options.typesPackages ?? packages, cwd)
    : undefined;

  if (options.format === 'hosted') {
    const outDir = resolve(cwd, options.outDir!);
    await mkdir(outDir, { recursive: true });

    for (const pkg of packages) {
      const code = await bundlePackage(pkg, externalsFor(pkg, externals), nodeEnv, cwd);
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
  for (const pkg of packages) {
    const code = await bundlePackage(pkg, externalsFor(pkg, externals), nodeEnv, cwd);
    const dataUrl = toDataUrl(code);
    importMap.imports[pkg] = dataUrl;
  }
  return types ? { importMap, types } : { importMap };
}

function withRequiredCore(packages: string[], include: boolean): string[] {
  const seen = new Set(packages);
  if (!include) return [...seen];
  const missing = REQUIRED_CORE.filter((s) => !seen.has(s));
  return [...missing, ...packages];
}

/**
 * Auto-derive externals for `specifier` from `all`. Excludes the specifier
 * itself, plus any other listed entry that's a subpath of the same physical
 * package — e.g. when bundling `react-dom/client`, never externalize
 * `react-dom`. Subpaths of the same package share internal state via
 * package-relative imports; splitting them across module records breaks the
 * createRoot machinery.
 *
 * Exception: `react` is always externalized when listed, even from its own
 * subpaths. It is the canonical shared singleton of the ecosystem — every
 * jsx-runtime, react-dom, third-party hook library MUST see the same React
 * instance, or hook calls cross instance boundaries and React throws
 * "Invalid hook call". `react/jsx-runtime`'s body only consumes React's
 * stable public API (createElement), not its internal state, so sharing
 * is safe.
 */
function externalsFor(specifier: string, all: string[]): string[] {
  const pkg = packageOf(specifier);
  return all.filter((s) => {
    if (s === specifier) return false;
    if (packageOf(s) === pkg) return s === 'react';
    return true;
  });
}

function packageOf(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? parts.slice(0, 2).join('/') : specifier;
  }
  const slash = specifier.indexOf('/');
  return slash === -1 ? specifier : specifier.slice(0, slash);
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
  candidateExternals: string[],
  nodeEnv: 'development' | 'production',
  cwd: string,
): Promise<string> {
  const esbuild = await loadEsbuild();

  // esbuild's `export * from "<cjs>"` with `format: 'esm'` emits a runtime
  // `__reExport(__toESM(...))` shim with no static `export const` lines, so
  // named imports against the bundle resolve to undefined. Instead, discover
  // the actual export names via Node and emit explicit per-name re-exports;
  // those esbuild surfaces statically.
  const { names, hasDefault } = await discoverExports(specifier, cwd);
  const lines = [
    `import * as __M from ${JSON.stringify(specifier)};`,
    ...names.map((n) => `export const ${n} = __M[${JSON.stringify(n)}];`),
  ];
  if (hasDefault && shouldReexportDefault(specifier)) {
    lines.push(`export default __M.default;`);
  }
  const entry = lines.join('\n') + '\n';

  // Marking a package as external when the bundled body never references it
  // is not a no-op: each banner `import * as __ext_N from "X"` forces the
  // browser to evaluate X's bundle as a side effect of loading this one.
  // For packages without any cross-package deps (e.g. react-refresh/runtime),
  // that drags in modules whose initialization order matters — notably
  // breaks the preamble → injectIntoGlobalHook → React init sequence.
  // So: probe with the full candidate set, then keep only the externals the
  // body actually references.
  const result = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: cwd,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    write: false,
    minify: false,
    metafile: true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
    },
    legalComments: 'none',
    logLevel: 'silent',
    // esbuild's built-in `external` matches subpaths too — externalizing
    // `react` would also externalize `react/jsx-runtime` from inside its own
    // bundle and create a self-import. Use a plugin for exact matches only.
    plugins:
      candidateExternals.length > 0
        ? [
            {
              name: 'exact-external',
              setup(b) {
                const set = new Set(candidateExternals);
                b.onResolve({ filter: /.*/ }, (args) => {
                  if (set.has(args.path)) return { path: args.path, external: true };
                  return null;
                });
              },
            },
          ]
        : [],
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error(`esbuild produced no output for '${specifier}'`);

  const referenced = referencedExternals(result.metafile, candidateExternals);
  return prependBanner(output, referenced);
}

/**
 * Inspect esbuild's metafile to find which of `candidates` were actually
 * imported (and therefore externalized) by the produced bundle.
 */
function referencedExternals(
  metafile: import('esbuild').Metafile | undefined,
  candidates: string[],
): string[] {
  if (!metafile) return [];
  const outputs = Object.values(metafile.outputs);
  if (outputs.length === 0) return [];
  const candidateSet = new Set(candidates);
  const seen = new Set<string>();
  for (const out of outputs) {
    for (const imp of out.imports) {
      if (imp.external && candidateSet.has(imp.path)) seen.add(imp.path);
    }
  }
  return candidates.filter((c) => seen.has(c));
}

/**
 * Banner with one ESM namespace import per actually-referenced external,
 * plus a `globalThis.require` shim for esbuild's CJS-to-ESM interop:
 * esbuild emits `__require("react")` for nested `require()` calls into
 * externalized packages, and the browser has no `require`.
 */
function prependBanner(output: string, external: string[]): string {
  if (external.length === 0) return output;
  const banner =
    external.map((ext, i) => `import * as __ext_${i} from ${JSON.stringify(ext)};`).join('\n') +
    '\n' +
    `if (typeof globalThis.require === 'undefined') globalThis.require = function(id){\n` +
    external
      .map(
        (ext, i) => `  if (id === ${JSON.stringify(ext)}) return __ext_${i}.default ?? __ext_${i};`,
      )
      .join('\n') +
    `\n  throw new Error('Cannot require: ' + id);\n};\n`;
  return banner + output;
}

/**
 * jsx-runtime / jsx-dev-runtime: even though Node's CJS-to-ESM interop
 * gives them a `default` (the full module.exports namespace), re-exporting
 * it as default would let `import jsx from 'react/jsx-runtime'` succeed
 * with the namespace — confusing and not a documented API.
 */
function shouldReexportDefault(specifier: string): boolean {
  if (specifier.endsWith('/jsx-runtime') || specifier.endsWith('/jsx-dev-runtime')) {
    return false;
  }
  return true;
}

/**
 * Resolve `specifier` from `cwd` and inspect its export shape. Returns the
 * list of named exports (filtered to valid JS identifiers — keys that
 * couldn't appear in `export const X`) and whether the module has a real
 * `default` export.
 */
async function discoverExports(
  specifier: string,
  cwd: string,
): Promise<{ names: string[]; hasDefault: boolean }> {
  const anchor = pathToFileURL(join(cwd, '__entry__.js')).href;
  const resolved = createRequire(anchor).resolve(specifier);
  const mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  const keys = Object.keys(mod);
  return {
    names: keys.filter((k) => k !== 'default' && isValidExportName(k)),
    hasDefault: keys.includes('default'),
  };
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

function isValidExportName(name: string): boolean {
  if (RESERVED.has(name)) return false;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
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
