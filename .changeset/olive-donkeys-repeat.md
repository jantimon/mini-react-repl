---
'mini-react-repl': minor
---

Make `repl-vendor-build --prod` usable

The flag set `NODE_ENV=production` as documented, but any bundle built with it
crashed the preview on its first render, and nothing in the repo built with it, so
it went unnoticed. Three things were wrong: the transform hardcoded SWC's
`development: true`, so every element compiled to a `jsxDEV()` call that production
React exports as `undefined`; Refresh signatures were still emitted into a React with
no Refresh hook; and `react-refresh/runtime`'s production entry is a bare `throw`,
which the iframe runtime imports unconditionally.

A bundle now declares which React it carries. `repl-vendor-build` writes
`development: false` into the generated `index.ts` for `--prod`, the transform reads
it and matches, and a production bundle pins `react-refresh/runtime` to its
development build so the import resolves (nothing calls it once Refresh is off). The
mismatch is unrepresentable rather than merely documented: the transform always
matches the React it calls into, whatever props you pass. Nothing to configure —
`VendorBundle.development` defaults to `true`, and a development bundle is
byte-identical to before.

A production vendor forces `hmr` off, since production React has no Refresh hook to
bind to; passing `hmr={true}` alongside one warns in dev. It also can't support
`<InspectMode/>` (no fiber debug info) and yields React's terser error messages —
it suits a read-only preview, not an editing surface. `examples/custom-vendor` now
builds one (`?prod`), giving the flag its first test in CI.
