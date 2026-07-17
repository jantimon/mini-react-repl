---
'mini-react-repl': minor
---

Re-host vendor `data:` modules as `blob:` URLs in the preview

A module's URL repeats in every stack frame and location capture, and Firefox
re-escapes it each time — so `react-dom/client`'s ~1.3 MB `data:` URL cost
milliseconds per render. It's now a ~46-character `blob:` URL. When the map holds
`data:` entries `generatePreviewHtml` declares it at boot rather than inlining a
static `<script type="importmap">`; maps without them are inlined as before.
