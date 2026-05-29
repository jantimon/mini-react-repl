/**
 * Discovers the relative imports of a transformed module and rewrites
 * them to a stable, recognizable form so the iframe runtime can swap in
 * blob URLs at load time.
 *
 * Why we don't substitute blob URLs here: parent-created blob URLs
 * don't load reliably across the iframe's opaque sandbox origin
 * (Chromium scopes the URL to its creating realm). Instead, the parent
 * reports the dependency list and the iframe rewrites + creates blobs
 * in its own context.
 *
 * Uses `es-module-lexer` instead of a full parse: swc has already
 * verified the syntax, we only need to find import specifier ranges.
 *
 * @internal
 */

import { init, parse, type ImportSpecifier } from 'es-module-lexer';
import { resolveRelative, splitSpecifier } from './path-utils.ts';
import type { ReplCdnResolver } from '../types.ts';

/**
 * Prefix used for the registry-key of virtual modules. Null-byte makes the
 * key impossible to type by hand and ensures it can never collide with a
 * user-supplied path. Exposed so the engine and runtime agree on shape;
 * not part of the public API.
 *
 * @internal
 */
export const VIRTUAL_KEY_PREFIX = '\0virtual:';

let lexerReady: Promise<void> | null = null;

/**
 * Lazily initialize the lexer. Idempotent across calls; the underlying
 * `init` is itself a one-shot promise.
 */
export function initLexer(): Promise<void> {
  if (!lexerReady) lexerReady = init;
  return lexerReady;
}

export type RewriteResult = {
  /** Transformed JS, with relative specifiers normalized (matching extension included). */
  code: string;
  /** Discovered relative deps: { specifier (as it appears in code), target (logical path) }. */
  deps: { specifier: string; target: string }[];
};

/**
 * Optional resolution config for bare specifiers. Without it, bare specifiers
 * pass through untouched — the iframe's import map resolves them, or they
 * error as unresolved.
 *
 * Modelled as a discriminated union so a CDN resolver can never be supplied
 * without the vendor-key set it depends on: were `vendorKeys` absent, *every*
 * bare specifier — React included — would classify as uncovered and route to
 * the CDN, double-loading React and breaking the singleton ("Invalid hook
 * call"). The pairing is therefore mandatory at the type level.
 */
export type BareSpecifierResolution =
  | {
      /** Resolver for bare specifiers the vendor map doesn't cover. */
      cdn: ReplCdnResolver;
      /**
       * The prebuilt vendor import map's keys, verbatim — including
       * trailing-slash prefix mappings (`react-dom/`). A bare specifier the map
       * serves passes through to the import map; anything else is offered to
       * {@link BareSpecifierResolution.cdn}. "Serves" means an exact key match
       * OR a trailing-slash prefix match, so a subpath under a prefix mapping
       * (`react-dom/client` via `react-dom/`) is recognized as vendored rather
       * than misrouted to the CDN.
       *
       * These keys also seed the resolver's `sharedDependencies`, reduced to
       * top-level package names, so lazy packages reuse the vendor's singletons
       * (React above all) — see {@link ReplCdnResolver}.
       */
      vendorKeys: ReadonlySet<string>;
      /**
       * Version pins declared in the REPL's `package.json` (package name →
       * range), forwarded verbatim to the resolver as its `declaredVersions`
       * argument. The session reads these via `PackageManifest`; `undefined`
       * when there's no manifest or it declares no usable `dependencies`.
       */
      declaredVersions?: Record<string, string>;
    }
  | {
      /** No CDN configured: bare specifiers pass through to the import map. */
      cdn?: undefined;
      vendorKeys?: ReadonlySet<string>;
      declaredVersions?: undefined;
    };

/**
 * Walk the imports, normalize each relative specifier so it matches its
 * resolved target file's path with extension (e.g. `'./Counter'` →
 * `'./Counter.tsx'`), and report the deps. Bare specifiers are passed
 * through unchanged (resolved by the iframe's import map).
 *
 * The iframe runtime later does a literal string replace of each
 * (quoted) specifier with the current blob URL of its target. By
 * normalizing here we guarantee a unique, predictable substring to
 * replace.
 *
 * Bare specifiers in `virtualAliases` are reported as deps too — same
 * substitution model — so user code's `import '@foo/bar'` resolves to the
 * iframe-minted blob URL of the virtual module (rather than going through
 * the import map). The literal text in `code` is left untouched, exactly
 * matching what `runtime.ts buildBlobUrl()` looks for when substituting.
 *
 * A bare specifier that is neither virtual nor a vendor key is offered to
 * `resolution.cdn` (when configured). A returned URL is baked into the code
 * as an absolute specifier — it bypasses the import map, so it's NOT reported
 * as a dep and the iframe imports it directly. Returning `null` leaves the
 * specifier as-is, so it surfaces as an unresolved-module error.
 *
 * @param fromPath       logical path of the module being rewritten
 * @param code           transformed JS body (output of swc)
 * @param files          current file table (for existence checks)
 * @param virtualAliases bare specifiers that resolve to virtual modules
 * @param resolution     optional vendor-key set + CDN resolver for bare specifiers
 *
 * @throws {ResolveError} if a relative import does not resolve
 */
export function rewriteImports(
  fromPath: string,
  code: string,
  files: Record<string, string>,
  virtualAliases?: ReadonlySet<string>,
  resolution?: BareSpecifierResolution,
): RewriteResult {
  const [specifiers] = parse(code);
  const deps: { specifier: string; target: string }[] = [];

  const cdn = resolution?.cdn;
  const vendorKeys = resolution?.vendorKeys;
  const declaredVersions = resolution?.declaredVersions;

  // A bare specifier is served by the vendor import map if it matches a key
  // exactly OR falls under a trailing-slash prefix mapping (the key
  // `react-dom/` covers `react-dom/client`). Both pass through to the import
  // map; only genuinely-uncovered specifiers reach the CDN.
  const isVendorCovered = (name: string): boolean => {
    if (!vendorKeys) return false;
    if (vendorKeys.has(name)) return true;
    for (const key of vendorKeys) {
      if (key.endsWith('/') && name.startsWith(key)) return true;
    }
    return false;
  };

  // Snapshot once: the shared singletons handed to every CDN call. Reduced to
  // top-level package names and deduped — a CDN externalizes a whole package,
  // so subpath keys (`react/jsx-runtime`) and prefix mappings (`react-dom/`)
  // collapse to their package. Only materialized when a resolver is present.
  const sharedDependencies =
    cdn && vendorKeys ? [...new Set([...vendorKeys].map(toPackageName))] : [];

  let out = '';
  let pos = 0;

  for (const spec of specifiers as readonly ImportSpecifier[]) {
    const start = spec.s;
    const end = spec.e;
    if (start < 0 || end < 0) continue;

    // For static imports `s..e` excludes quotes; for dynamic imports
    // `d >= 0` it includes them. Normalize via the lexer-parsed `n`
    // when it's present (string-literal arguments only).
    const isDynamic = spec.d >= 0;
    const slice = code.slice(start, end);
    const name = spec.n ?? unquote(slice);
    if (name === null) {
      continue; // dynamic import with a non-literal argument; leave alone
    }

    out += code.slice(pos, start);

    if (name.startsWith('.') || name.startsWith('/')) {
      // A leading `.` is always relative — npm forbids package names from
      // starting with `.`, so this also covers `../`, which can never resolve
      // in the flat file namespace and so must surface as a ResolveError
      // rather than be misrouted to the CDN as a garbage `esm.sh/../foo` URL.
      const target = resolveRelative(name, files);
      if (target === null) throw new ResolveError(fromPath, name);
      if (target.endsWith('.css')) {
        // CSS is injected as a <style> tag by the engine; the JS-level
        // `import './foo.css'` is side-effect-only. Substitute an empty
        // data: URL — a real relative specifier can't resolve against the
        // module's blob: URL (blob URLs are non-hierarchical).
        out += isDynamic ? `'data:text/javascript,'` : `data:text/javascript,`;
      } else {
        // Emit a normalized specifier: '/<target-path>' (always with leading
        // slash, full extension included). Stable, unique, easy to find.
        const normalized = `./${target}`;
        deps.push({ specifier: normalized, target });
        out += isDynamic ? `'${normalized}'` : normalized;
      }
    } else if (virtualAliases?.has(name)) {
      deps.push({ specifier: name, target: VIRTUAL_KEY_PREFIX + name });
      out += isDynamic ? `'${name}'` : name;
    } else if (cdn && !isVendorCovered(name)) {
      // Bare specifier the vendor import map doesn't cover — offer it to the
      // CDN resolver. An absolute URL bypasses the import map (no reload, not
      // a tracked dep); a null result falls through to the import map, where
      // it surfaces as an unresolved-module error.
      const url = cdn(name, sharedDependencies, fromPath, declaredVersions);
      const replacement = url ?? name;
      out += isDynamic ? `'${replacement}'` : replacement;
    } else {
      // Bare specifier the iframe's import map resolves (vendor) — or no CDN
      // configured. Pass through unchanged.
      out += isDynamic ? `'${name}'` : name;
    }
    pos = end;
  }
  out += code.slice(pos);

  return { code: out, deps };
}

/**
 * Reduce an import-map key to its top-level package name: `react/jsx-runtime`
 * and the prefix mapping `react-dom/` both collapse to their package, while a
 * scope is kept whole (`@mui/material/styles` → `@mui/material`). Used to build
 * the CDN's package-level `sharedDependencies` (esm.sh's `?external`).
 */
function toPackageName(specifier: string): string {
  return splitSpecifier(specifier).packageName;
}

function unquote(s: string): string | null {
  if (s.length < 2) return null;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === '"' || first === "'") && first === last) return s.slice(1, -1);
  return null;
}

/** Thrown when a relative import does not resolve. */
export class ResolveError extends Error {
  override readonly name = 'ResolveError';
  constructor(
    public readonly path: string,
    public readonly specifier: string,
  ) {
    super(`Cannot resolve '${specifier}' from '${path}'`);
  }
}
