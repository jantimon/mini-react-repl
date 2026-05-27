/**
 * V8 `Error.stack` parser.
 *
 * V8 emits one of two shapes per call site:
 *   - `at FnName (path:line:col)`        — named call site
 *   - `at path:line:col`                 — anonymous / module-level
 *
 * The parser extracts every recognizable frame and skips lines that don't
 * match (the leading `Error: …` summary, async wrappers, etc.). It does
 * **not** filter by URL scheme — the caller decides which frames are worth
 * looking up against a source map.
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
  return null;
}

/**
 * Schemes we never look up against a source map: vendor/framework URLs
 * (no inline map points at user `.tsx`), `blob:` URLs (the preview
 * document, plus module blobs minted inside the iframe), and
 * `about:srcdoc` (kept for back-compat with older frames; the iframe
 * document loads from `blob:` today).
 */
const NON_SOURCE_SCHEME =
  /^(?:https?|blob|data|file|chrome-extension|moz-extension|webpack|about):/i;

/**
 * `true` if this frame's `fileName` is a candidate for source-map lookup
 * (i.e. a `//# sourceURL` pragma value, like `App.tsx`). Vendor / blob /
 * about: frames return `false`.
 */
export function isSourceCandidate(frame: ParsedFrame): boolean {
  if (!frame.fileName) return false;
  return !NON_SOURCE_SCHEME.test(frame.fileName);
}
