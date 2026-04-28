/**
 * Generates the srcdoc HTML for the preview iframe.
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

import type { ImportMap, VendorBundle } from './types.ts';
import { PREAMBLE_CODE, RUNTIME_CODE } from './runtime/runtime.bundled.ts';

export type PreviewHtmlOptions = {
  /** Vendor bundle to inline as `<script type="importmap">`. */
  vendor: VendorBundle;
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
 * Build the iframe srcdoc string from the given options.
 *
 * Idempotent and pure — same options produce the same string. Cheap enough
 * to call inside React render, but `<ReplPreview/>` memoizes anyway.
 */
export function generatePreviewHtml(options: PreviewHtmlOptions): string {
  const importMap = resolveImportMap(options.vendor);
  const overlayAttr = options.showErrorOverlay === false ? 'data-overlay="off"' : '';
  return `<!doctype html>
<html lang="en" ${overlayAttr}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Preview</title>
${options.headHtml ?? ''}
<script type="importmap">${JSON.stringify(importMap)}</script>
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

/**
 * Resolve the import-map entries against `vendor.baseUrl`, if set. Leaves
 * absolute URLs (https:, data:, blob:) unchanged.
 */
function resolveImportMap(vendor: VendorBundle): ImportMap {
  if (!vendor.baseUrl) return vendor.importMap;
  const base = vendor.baseUrl.replace(/\/+$/, '');
  const next: ImportMap = { imports: {} };
  for (const [k, v] of Object.entries(vendor.importMap.imports)) {
    next.imports[k] = isAbsolute(v) ? v : `${base}/${v.replace(/^\/+/, '')}`;
  }
  if (vendor.importMap.scopes) {
    next.scopes = {};
    for (const [scope, mapping] of Object.entries(vendor.importMap.scopes)) {
      next.scopes[scope] = {};
      for (const [k, v] of Object.entries(mapping)) {
        next.scopes[scope]![k] = isAbsolute(v) ? v : `${base}/${v.replace(/^\/+/, '')}`;
      }
    }
  }
  return next;
}

function isAbsolute(url: string): boolean {
  // Includes root-relative paths (`/foo`): the CLI's hosted format already
  // emits `${baseUrl}/${filename}`, so re-prepending baseUrl in the consumer
  // would double the prefix.
  return /^(?:[a-z]+:|data:|blob:|\/)/i.test(url);
}
