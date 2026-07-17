---
'mini-react-repl': patch
---

Point the generated vendor header at `--out`

`repl-vendor-build --out other.generated` wrote a header telling readers to
`import … from './vendor.generated'` — the default folder, not the one it built.
The header now names the folder it actually wrote.
