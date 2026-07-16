---
'mini-react-repl': patch
---

Fix `showPreviewErrorOverlay={false}` having no effect

`generatePreviewHtml` writes `data-overlay="off"` on the preview document, but
the runtime read it off `window.frameElement` — the host's iframe element, which
nothing sets it on, and which is null across the preview's opaque sandbox origin
anyway. The overlay always showed. Read it from the document instead.
