---
'mini-react-repl': patch
---

Fix the inspect picker on Firefox and Safari

The picker's `Error.stack` parser only recognized V8's `at FnName (path:line:col)`
shape, so on Firefox/Safari (which emit `FnName@path:line:col`) every owner-stack
frame failed to parse and clicking an element in `<InspectMode/>` silently
produced an empty stack. `parseStack` now also recognizes the `@`-form.

Separately, on Safari the wrapped module's `//# sourceURL` pragma is not honored
for ES modules imported from a `blob:` URL — SpiderMonkey and V8 report the
logical path (e.g. `App.tsx`) as the frame's file, but JavaScriptCore reports the
blob URL itself. `getModuleRecord` now falls back to matching a frame's blob URL
against each registered module's current `blobUrl` when the direct path lookup
misses, so Safari resolves the same frame V8/Firefox resolve by path.
