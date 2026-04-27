/**
 * Discovers the relative imports of a transformed module and rewrites
 * them to a stable, recognizable form so the iframe runtime can swap in
 * blob URLs at load time.
 *
 * Why we don't substitute blob URLs here: parent-created blob URLs
 * don't load reliably in srcdoc iframes (Chromium scopes the URL to
 * the creating document). Instead, the parent reports the dependency
 * list and the iframe rewrites + creates blobs in its own context.
 *
 * Uses `es-module-lexer` instead of a full parse: swc has already
 * verified the syntax, we only need to find import specifier ranges.
 *
 * @internal
 */

import { init, parse, type ImportSpecifier } from 'es-module-lexer';
import { resolveRelative } from './path-utils.ts';

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
  /** Bare specifiers used (informational; useful for missing-import warnings). */
  bareSpecifiers: string[];
};

/**
 * Rewrite relative specifiers to blob URLs from `blobs`. Bare specifiers
 * are passed through unchanged (resolved by the iframe's import map).
 *
 * If a relative specifier targets a path not in `files`, throws a
 * {@link ResolveError} so the caller can surface it through the error overlay.
 *
 * @param fromPath logical path of the module being rewritten
 * @param code     transformed JS body (output of swc)
 * @param files    current file table (for existence checks)
 * @param blobs    logical path → current blob URL
 *
 * @throws {ResolveError} if a relative import does not resolve
 */
/**
 * Walk the imports, normalize each relative specifier so it matches its
 * resolved target file's path with extension (e.g. `'./Counter'` →
 * `'./Counter.tsx'`), and report the deps.
 *
 * The iframe runtime later does a literal string replace of each
 * (quoted) specifier with the current blob URL of its target. By
 * normalizing here we guarantee a unique, predictable substring to
 * replace.
 */
export function rewriteImports(
  fromPath: string,
  code: string,
  files: Record<string, string>,
): RewriteResult {
  const [specifiers] = parse(code);
  const deps: { specifier: string; target: string }[] = [];
  const bareSpecifiers: string[] = [];

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

    if (name.startsWith('./') || name.startsWith('/')) {
      const target = resolveRelative(name, files);
      if (target === null) throw new ResolveError(fromPath, name);
      // Emit a normalized specifier: '/<target-path>' (always with leading
      // slash, full extension included). Stable, unique, easy to find.
      const normalized = `./${target}`;
      deps.push({ specifier: normalized, target });
      out += isDynamic ? `'${normalized}'` : normalized;
    } else {
      bareSpecifiers.push(name);
      out += isDynamic ? `'${name}'` : name;
    }
    pos = end;
  }
  out += code.slice(pos);

  return { code: out, deps, bareSpecifiers };
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
