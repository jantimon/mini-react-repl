---
'mini-react-repl': minor
---

Re-host vendor `data:` modules as `blob:` URLs in the preview

`repl-vendor-build` ships each vendor package as a `data:text/javascript;base64,…`
URL, which makes the import map's `react-dom/client` entry ~1.3 MB long. A module's
URL is its identity, so it reappears in every stack frame and location capture — and
Firefox re-escapes it on each one. React's dev build calls `console.timeStamp` once
per component render, so a render-heavy preview spent milliseconds per render inside
that escape and saturated its main thread. Chrome doesn't charge for it, so this only
ever showed up off-Chromium. The preview now decodes those entries into `blob:` URLs
— minted inside the iframe, so they load across the sandbox's opaque origin — and
declares the import map with those: ~46 characters instead of 1.3 million. Error
stacks improve for free, with vendor frames reading `at renderWithHooks
(react-dom/client:123:45)`.

Vendor bundles, `VendorBundle.importMap`, and the `data:` URLs `repl-vendor-build`
emits are all untouched. One shape change if you call `generatePreviewHtml` directly:
when the map holds `data:` entries, the static `<script type="importmap">` is replaced
by a small script that declares the same map at boot. Maps without them (e.g. CDN
vendors) are still inlined verbatim. The e2e suite now also runs on Firefox, which is
what caught this.
