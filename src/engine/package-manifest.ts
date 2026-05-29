/**
 * Reads dependency version pins out of a REPL `package.json`. A transform
 * session owns one instance and consults it on every rewrite; the parse is
 * cached by raw source, so a manifest is parsed at most once per distinct
 * content (and re-parsed the moment the user edits it). Best-effort
 * throughout — a half-typed or malformed manifest yields no pins rather than
 * breaking a transform.
 *
 * @internal
 */

/** Logical path of the dependency manifest in the REPL file table. */
export const PACKAGE_JSON_PATH = 'package.json';

export class PackageManifest {
  // Single-entry cache keyed by raw source: every module in a rewrite batch
  // shares the same `package.json`, so parse it once rather than per module.
  // Survives across batches and invalidates the moment the source changes.
  private cache: { source: string; deps: Record<string, string> | undefined } | null = null;

  /**
   * The `dependencies` map declared in `source` (package name → version range),
   * or `undefined` when the file is absent, isn't valid JSON, or has no usable
   * `dependencies` object.
   */
  dependencies(source: string | undefined): Record<string, string> | undefined {
    if (source === undefined) return undefined;
    if (this.cache && this.cache.source === source) return this.cache.deps;
    const deps = parseDependencies(source);
    this.cache = { source, deps };
    return deps;
  }
}

function parseDependencies(source: string): Record<string, string> | undefined {
  try {
    const parsed: unknown = JSON.parse(source);
    const raw = (parsed as { dependencies?: unknown } | null)?.dependencies;
    if (!raw || typeof raw !== 'object') return undefined;
    // Keep only string ranges — a malformed entry (number, nested object)
    // can't be a version specifier and would corrupt the CDN URL.
    const entries = Object.entries(raw).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  } catch {
    // Malformed JSON — ignore and fall back to the resolver's own config.
    return undefined;
  }
}
