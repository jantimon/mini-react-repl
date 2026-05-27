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
  /** Raw HTML injected into `<head>` before the import map. */
  headHtml?: string;
  /** Raw HTML injected into `<body>` after the React mount node. */
  bodyHtml?: string;
  /**
   * If `false`, the in-iframe error overlay is suppressed. Errors still
   * flow to the parent via `onPreviewError`. Defaults to `true`.
   */
  showErrorOverlay?: boolean;
};

/**
 * Build the preview document HTML string from the given options. The
 * caller wraps this in a Blob and assigns the resulting `blob:` URL to
 * the iframe's `src`.
 *
 * Idempotent and pure — same options produce the same string. Cheap enough
 * to call inside React render, but `<ReplPreview/>` memoizes anyway.
 */
export function generatePreviewHtml(options: PreviewHtmlOptions): string {
  const overlayAttr = options.showErrorOverlay === false ? 'data-overlay="off"' : '';
  return `<!doctype html>
<html lang="en" ${overlayAttr}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
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
<!-- preamble: installs the React Refresh hook before React initializes -->
<script type="module">${PREAMBLE_CODE}</script>
<script type="module">${RUNTIME_CODE}</script>
</body>
</html>`;
}
