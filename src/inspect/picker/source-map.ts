/**
 * In-iframe source-map lookup cache. Reads the inline base64 source map
 * out of a wrapped module's source, parses it once via
 * `@jridgewell/trace-mapping`, caches by logical path, and translates
 * compiled `(line, col)` into source `(fileName, line, col)`.
 *
 * The wrapped module is `mini-react-repl`'s output — `wrapModuleBody`
 * already shifts the inline map by 1 line to account for the prologue, so
 * we do **no** arithmetic here. Compiled position → source position is a
 * direct lookup.
 *
 * @internal
 */

import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

import type { ModuleRecordLike } from './module-text.ts';

const cache = new Map<string, TraceMap | null>();

const SOURCE_MAPPING_URL_RE =
  /\/\/# sourceMappingURL=data:application\/json(?:;[^;,]*)?;base64,([A-Za-z0-9+/=]+)/;

/**
 * Parse and cache the source map for the module at `path`. Subsequent
 * calls for the same path return the cached `TraceMap` instance.
 *
 * `null` means "we already tried and there's nothing we can decode" —
 * either the module hasn't been wrapped yet, or its body has no inline
 * source map. The cache stores that negative result too so we don't keep
 * re-attempting on every click.
 *
 * @param getRecord callback to look up a module record by logical path
 */
export function getTraceMap(
  path: string,
  getRecord: (path: string) => ModuleRecordLike | undefined,
): TraceMap | null {
  if (cache.has(path)) return cache.get(path) ?? null;
  const rec = getRecord(path);
  const source = rec?.compiledSource;
  if (!source) {
    // Don't cache a negative result yet — the module may compile later.
    return null;
  }
  const match = source.match(SOURCE_MAPPING_URL_RE);
  if (!match || !match[1]) {
    cache.set(path, null);
    return null;
  }
  try {
    const json = utf8FromBase64(match[1]);
    const map = new TraceMap(JSON.parse(json));
    cache.set(path, map);
    return map;
  } catch {
    cache.set(path, null);
    return null;
  }
}

/**
 * Drop the cached `TraceMap` for `path`. Call this when the iframe runtime
 * recompiles a module so the next click reads the fresh map.
 */
export function invalidateTraceMap(path: string): void {
  cache.delete(path);
}

/** Strip every cached map. Used for test isolation. */
export function clearTraceMapCache(): void {
  cache.clear();
}

/**
 * Translate a compiled `(line, col)` position in `path` into source space.
 * Returns `null` if the source map is missing, malformed, or has no
 * mapping for the given position.
 */
export function lookupSourcePosition(
  path: string,
  compiledLine: number,
  compiledCol: number,
  getRecord: (path: string) => ModuleRecordLike | undefined,
): { fileName: string; lineNumber: number; columnNumber: number } | null {
  const map = getTraceMap(path, getRecord);
  if (!map) return null;
  const result = originalPositionFor(map, { line: compiledLine, column: compiledCol });
  if (result.source == null || result.line == null || result.column == null) return null;
  return {
    fileName: result.source,
    lineNumber: result.line,
    // trace-mapping reports 0-based columns; we expose 1-based in the API.
    columnNumber: result.column + 1,
  };
}

function utf8FromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
