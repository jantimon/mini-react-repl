/**
 * `Error.stack` parser, tolerant of both stack dialects browsers use.
 *
 * V8 (Chrome, Edge, Node) emits one of two shapes per call site:
 *   - `at FnName (path:line:col)`        — named call site
 *   - `at path:line:col`                 — anonymous / module-level
 *
 * Firefox and Safari (SpiderMonkey / JavaScriptCore) instead emit:
 *   - `FnName@path:line:col`             — named call site
 *   - `@path:line:col`                   — anonymous / module-level
 *
 * The parser extracts every recognizable frame and skips lines that don't
 * match any shape (the leading `Error: …` summary, async wrappers, etc.). It
 * does **not** filter by URL scheme — the caller decides which frames are
 * worth looking up against a source map.
 *
 * @internal
 */

export type ParsedFrame = {
  /** Function or component name, or `null` for bare frames. */
  functionName: string | null;
  /** Whatever V8 placed in the parens — usually a `//# sourceURL` value. */
  fileName: string;
  /** 1-based line in the compiled module body. */
  line: number;
  /** 1-based column in the compiled module body. */
  col: number;
};

/**
 * Parse a V8 `Error.stack` string into individual frames.
 *
 * Returns frames in stack order (innermost → outermost). Lines that don't
 * match either V8 shape are silently dropped, so the result may be shorter
 * than the input has lines.
 */
export function parseStack(stack: string): ParsedFrame[] {
  const out: ParsedFrame[] = [];
  const lines = stack.split('\n');
  for (const line of lines) {
    const frame = parseLine(line);
    if (frame) out.push(frame);
  }
  return out;
}

function parseLine(line: string): ParsedFrame | null {
  // Named: `    at FnName (path:line:col)`
  const named = line.match(/\bat\s+([^\s(]+)\s+\(([^()]+):(\d+):(\d+)\)\s*$/);
  if (named) {
    return {
      functionName: named[1] ?? null,
      fileName: named[2] ?? '',
      line: Number(named[3]),
      col: Number(named[4]),
    };
  }
  // Bare: `    at path:line:col`
  const bare = line.match(/\bat\s+([^\s()]+):(\d+):(\d+)\s*$/);
  if (bare) {
    return {
      functionName: null,
      fileName: bare[1] ?? '',
      line: Number(bare[2]),
      col: Number(bare[3]),
    };
  }
  // Firefox / Safari: `FnName@path:line:col` or `@path:line:col` (anonymous).
  // functionName is everything up to the first `@` (may be empty); it can
  // itself contain `@`-free suffixes like `*` (generator/async markers) or
  // `/<` (anonymous-closure markers) — those are kept as-is since callers
  // only use functionName for display, never for lookup.
  const atForm = line.match(/^([^@]*)@([^@]+):(\d+):(\d+)$/);
  if (atForm) {
    return {
      functionName: atForm[1] || null,
      fileName: atForm[2] ?? '',
      line: Number(atForm[3]),
      col: Number(atForm[4]),
    };
  }
  return null;
}

/**
 * Schemes we never look up against a source map: vendor/framework URLs (no
 * inline map points at user `.tsx`) and `about:srcdoc` (kept for back-compat
 * with older frames; the iframe document loads from `blob:` today).
 *
 * `blob:` is deliberately **not** here. On V8 and SpiderMonkey, a wrapped
 * user module's frame names its logical path (`App.tsx`) via the `//#
 * sourceURL` pragma `wrapModuleBody` adds, and that's the only shape those
 * two engines ever report for it — a `blob:` frame from either engine is
 * always vendor/runtime code with no source map, so excluding the whole
 * scheme was harmless. JavaScriptCore (Safari) does not honor that pragma
 * for ES modules loaded via `import()` of a `blob:` URL, though, and
 * instead reports the module's blob URL itself — so on Safari a user
 * module's frame *is* a `blob:` URL. `getModuleRecord`'s blob-URL fallback
 * resolves that case; a genuine vendor/runtime blob (not a registered
 * module) still safely falls through as a lookup miss (`lookupSourcePosition`
 * returns `null`), so widening this filter costs nothing beyond one extra
 * (cheap) lookup attempt per such frame.
 */
const NON_SOURCE_SCHEME = /^(?:https?|data|file|chrome-extension|moz-extension|webpack|about):/i;

/**
 * `true` if this frame's `fileName` is a candidate for source-map lookup —
 * i.e. either a `//# sourceURL` pragma value like `App.tsx` (V8 /
 * SpiderMonkey), or a `blob:` URL that might resolve via
 * `getModuleRecord`'s blob-URL fallback (JavaScriptCore). Vendor / data /
 * about: frames return `false`.
 */
export function isSourceCandidate(frame: ParsedFrame): boolean {
  if (!frame.fileName) return false;
  return !NON_SOURCE_SCHEME.test(frame.fileName);
}
