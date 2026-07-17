---
'mini-react-repl': minor
---

Make `repl-vendor-build --prod` usable

Every `--prod` bundle crashed the preview on first render — the transform emitted
`jsxDEV`, which production React doesn't implement. Bundles now declare their React
build and the transform matches it. A prod vendor forces `hmr` off and rules out
`<InspectMode/>`; development bundles are unchanged.
