/**
 * Stack-trace sanitizer. Vendor packages arrive through the import map as
 * `data:text/javascript;base64,...` URLs (react-dom/client alone is ~1.3 MB),
 * and every stack frame inside such a module carries the full URL as its
 * file name — a single React error unwinds to a ~20 MB stack string.
 *
 * Known data URLs are replaced with their import-map specifier (so frames
 * read `at renderWithHooks (react-dom/client:123:45)`); unknown ones are
 * truncated. Works on the raw stack string, so both V8's
 * `at fn (url:l:c)` and SpiderMonkey/JSC's `fn@url:l:c` shapes pass through.
 *
 * @internal
 */

/**
 * Invert an import map's `imports` into data-URL → specifier. Non-data
 * values (http(s) CDN entries, blob URLs) are skipped — they're short.
 */
export function buildDataUrlLabels(imports: Record<string, string>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [specifier, url] of Object.entries(imports)) {
    if (url.startsWith('data:')) labels.set(url, specifier);
  }
  return labels;
}

// The payload after `;base64,` (or a percent-encoded body after `,`) never
// contains whitespace, `)`, or `:`, so the match ends exactly where the
// frame's `:line:col` suffix begins.
const DATA_URL_RE = /data:text\/javascript[^\s():]*[;,][^\s():]+/g;

/**
 * Replace every `data:text/javascript` URL in `text` with its import-map
 * specifier, or a 40-char prefix + `…` when the URL isn't in `labels`.
 */
export function sanitizeStack(text: string, labels: Map<string, string>): string {
  return text.replace(DATA_URL_RE, (url) => labels.get(url) ?? `${url.slice(0, 40)}…`);
}
