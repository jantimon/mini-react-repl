/**
 * Stack-trace sanitizer. Every stack frame names its module by URL, and
 * vendor packages arrive through the import map as opaque `blob:` URLs — or,
 * when the preview didn't re-host them, as multi-MB `data:` URLs that unwind
 * a single React error into a ~20 MB stack string.
 *
 * Known URLs are replaced with their import-map specifier (so frames read
 * `at renderWithHooks (react-dom/client:123:45)`); unknown data URLs are
 * truncated. Works on the raw stack string, so both V8's `at fn (url:l:c)`
 * and SpiderMonkey/JSC's `fn@url:l:c` shapes pass through.
 *
 * @internal
 */

/**
 * Invert an import map's `imports` into URL → specifier. `http(s)` entries
 * are skipped — they already read as themselves.
 */
export function buildUrlLabels(imports: Record<string, string>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [specifier, url] of Object.entries(imports)) {
    if (url.startsWith('data:') || url.startsWith('blob:')) labels.set(url, specifier);
  }
  return labels;
}

// The payload after `;base64,` (or a percent-encoded body after `,`) never
// contains whitespace, `)`, or `:`, so the match ends exactly where the
// frame's `:line:col` suffix begins.
const DATA_URL_RE = /data:text\/javascript[^\s():]*[;,][^\s():]+/g;

/**
 * Replace every labelled URL in `text` with its import-map specifier, and
 * truncate unlabelled `data:text/javascript` URLs to a 40-char prefix + `…`.
 *
 * Blob URLs are matched literally rather than by pattern: only the exact
 * vendor URLs in `labels` are rewritten, so a user module's own blob URL
 * (which the source-map layer still needs) survives untouched.
 */
export function sanitizeStack(text: string, labels: Map<string, string>): string {
  let out = text;
  for (const [url, specifier] of labels) {
    if (url.startsWith('blob:')) out = out.split(url).join(specifier);
  }
  return out.replace(DATA_URL_RE, (url) => labels.get(url) ?? `${url.slice(0, 40)}…`);
}
