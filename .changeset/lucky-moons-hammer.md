---
'mini-react-repl': minor
---

Add an `hmr` prop to opt out of Fast Refresh

Defaults to `true`, so nothing changes unless you ask. Pass `hmr={false}` for a
read-only preview whose files never change after boot: swc emits no Refresh
signatures, the preamble script is dropped, and modules are wrapped without the
Refresh prologue — so user stack traces carry no Refresh frames and the inline
source map passes through byte-exact.

Editing still works with `hmr={false}`, but every change costs a full re-boot of
the preview and component state is lost. Element inspection is unaffected.
