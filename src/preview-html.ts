/**
 * Generates the preview document HTML loaded into the iframe (via a
 * `blob:` URL minted in `<ReplPreview/>`).
 *
 * The output is a self-contained document that:
 *   - declares the import map (so `import 'react'` works in user code)
 *   - injects custom `headHtml` from the consumer
 *   - mounts a `<div id="root">` for React
 *   - injects custom `bodyHtml` from the consumer
 *   - inlines the iframe runtime as the last `<script type="module">`
 *
 * The runtime module sets up `window.__repl__`, registers Refresh, and
 * starts listening for postMessage from the parent.
 *
 * @public
 */

import type { ImportMap } from './types.ts';
import { PREAMBLE_CODE, RUNTIME_CODE } from './runtime/runtime.bundled.ts';

const DATA_MODULE_PREFIX = 'data:text/javascript;base64,';

export type PreviewHtmlOptions = {
  /**
   * Import map to declare in the preview document. The library resolves any
   * lazy `VendorBundle.importMap` thunk before calling this; direct callers
   * must pass a resolved (sync) `ImportMap`.
   *
   * Base64 `data:` module entries are re-hosted as short `blob:` URLs at
   * boot (multi-MB URLs are slow to capture in stacks). A map holding any is
   * therefore declared by a small script rather than inlined as a static
   * `<script type="importmap">`; maps without them are inlined verbatim.
   */
  importMap: ImportMap;
  /**
   * Value for the `<base href>` emitted as the first URL-bearing element in
   * `<head>`. Root-relative URLs in user code (e.g. `<img src="/img/x.png">`)
   * would otherwise resolve against the sandboxed `blob:` origin — which has
   * no server behind it — and fail. Pointing the base at a real origin makes
   * them resolve there instead.
   *
   * Omitted (`undefined`) defaults to the current page's
   * `window.location.origin` (with a trailing `/`), or to nothing when
   * `window` is undefined (SSR). Pass `null` to suppress the `<base>` tag
   * entirely.
   */
  baseHref?: string | null;
  /** Raw HTML injected into `<head>` before the import map. */
  headHtml?: string;
  /** Raw HTML injected into `<body>` after the React mount node. */
  bodyHtml?: string;
  /**
   * If `false`, the in-iframe error overlay is suppressed. Errors still
   * flow to the parent via `onPreviewError`. Defaults to `true`.
   */
  showErrorOverlay?: boolean;
  /**
   * If `false`, the Fast Refresh preamble is omitted and the runtime is told
   * to skip Refresh via `data-hmr="off"`. Pair with the transform's matching
   * `hmr` flag, which is what stops swc emitting the Refresh calls the
   * preamble would serve. Defaults to `true`.
   */
  hmr?: boolean;
};

/** JSON safe to inline in a `<script>`: `<` can't start a closing tag. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Every mapped URL: `imports` values plus each scope's values. */
function allUrls(map: ImportMap): string[] {
  return [
    ...Object.values(map.imports),
    ...Object.values(map.scopes ?? {}).flatMap((scope) => Object.values(scope)),
  ];
}

/**
 * The import map, as a tag the browser can consume.
 *
 * A module's URL shows up in every stack frame and location capture, and
 * Firefox re-escapes it each time — so multi-MB `data:` vendor entries cost
 * milliseconds per capture. When the map holds any, a classic script re-hosts
 * them as short `blob:` URLs (minted in here, so they load across the
 * sandbox's opaque origin) and declares the map. Otherwise it's inlined.
 *
 * Scope *keys* are left alone — only values are re-hosted. A map scoping
 * imports under a `data:` URL would stop matching; `repl-vendor-build` emits
 * no scopes, so nothing hits that today.
 */
function importMapTag(map: ImportMap): string {
  if (!allUrls(map).some((url) => url.startsWith(DATA_MODULE_PREFIX))) {
    return `<script type="importmap">${inlineJson(map)}</script>`;
  }
  return `<script>
(() => {
  const here = document.currentScript;
  const map = ${inlineJson(map)};
  const rehost = (url) => {
    if (!url.startsWith(${inlineJson(DATA_MODULE_PREFIX)})) return url;
    try {
      const bin = atob(url.slice(${DATA_MODULE_PREFIX.length}));
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    } catch {
      return url;
    }
  };
  for (const [spec, url] of Object.entries(map.imports)) map.imports[spec] = rehost(url);
  for (const scope of Object.values(map.scopes ?? {}))
    for (const [spec, url] of Object.entries(scope)) scope[spec] = rehost(url);
  const tag = document.createElement('script');
  tag.type = 'importmap';
  tag.textContent = JSON.stringify(map);
  here.after(tag);
})();
</script>`;
}

/**
 * Build the preview document HTML string from the given options. The
 * caller wraps this in a Blob and assigns the resulting `blob:` URL to
 * the iframe's `src`.
 *
 * Pure given its options, except that an omitted `baseHref` reads
 * `window.location.origin` — pass an explicit `baseHref` (or `null`) for a
 * deterministic result. Cheap enough to call inside React render, but
 * `<ReplPreview/>` memoizes anyway.
 */
export function generatePreviewHtml(options: PreviewHtmlOptions): string {
  const hmr = options.hmr !== false;
  const htmlAttrs = [
    'lang="en"',
    options.showErrorOverlay === false ? 'data-overlay="off"' : '',
    hmr ? '' : 'data-hmr="off"',
  ]
    .filter(Boolean)
    .join(' ');
  // `<base>` only governs URLs that follow it in source order, so it must be
  // the first URL-bearing element — ahead of both `headHtml` and the import
  // map. `undefined` falls back to the live origin (client-only); `null` opts
  // out. Stays empty under SSR where there's no `window`.
  const baseHref =
    options.baseHref === undefined
      ? typeof window !== 'undefined'
        ? `${window.location.origin}/`
        : null
      : options.baseHref;
  const baseTag = baseHref ? `<base href="${baseHref}">\n` : '';
  return `<!doctype html>
<html ${htmlAttrs}>
<head>
<meta charset="utf-8" />
${baseTag}<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Preview</title>
${options.headHtml ?? ''}
${importMapTag(options.importMap)}
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  #root { min-height: 100vh; }
</style>
</head>
<body>
<div id="root"></div>
${options.bodyHtml ?? ''}
${
  hmr
    ? `<!-- preamble: installs the React Refresh hook before React initializes -->
<script type="module">${PREAMBLE_CODE}</script>`
    : ''
}
<script type="module">${RUNTIME_CODE}</script>
</body>
</html>`;
}
