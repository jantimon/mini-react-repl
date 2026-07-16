---
'mini-react-repl': minor
---

Add an `hmr` prop to opt out of Fast Refresh

Defaults to `true`, so nothing changes unless you ask. Pass `hmr={false}` for a
read-only preview whose files never change after boot: swc emits no Refresh
signatures, the preamble script is dropped, and modules are wrapped without the
Refresh prologue — so what's left in each compiled module is your code, with no
Refresh work on every commit.

Editing still works with `hmr={false}`, but every change re-boots the preview
and component state is lost. Element inspection is unaffected.
