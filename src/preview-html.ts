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

export type PreviewHtmlOptions = {
  /**
   * Import map to inline as `<script type="importmap">`. The library
   * resolves any lazy `VendorBundle.importMap` thunk before calling this;
   * direct callers must pass a resolved (sync) `ImportMap`.
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
<script type="importmap">${JSON.stringify(options.importMap)}</script>
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
