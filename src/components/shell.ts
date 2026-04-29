/**
 * Synthetic root-component plumbing.
 *
 * The iframe runtime always mounts a single module called `ReplShell.tsx`
 * — never the user's entry directly. The shell wraps the consumer-facing
 * entry (default `App.tsx`) so callers can inject a `<Suspense>` boundary,
 * error boundary, theme provider, etc. without editing user code.
 *
 * @internal
 */

import type { Files } from '../types.ts';

/**
 * Logical path of the synthetic root module. Consumers may also drop a real
 * `ReplShell.tsx` into `files` to take over from the prop and edit the shell
 * live; that path wins over both the prop and the generated default.
 */
export const SHELL_PATH = 'ReplShell.tsx';

/**
 * No-op default export injected under the entry path when the consumer's
 * entry file is missing or blank. Keeps the shell's `import Entry from
 * './App'` resolvable and gives React a real component to mount, so HMR
 * stays alive while the user types from scratch.
 */
const ENTRY_FALLBACK_SOURCE = `export default function App() { return null }\n`;

function isBlankSource(s: string | undefined): boolean {
  return s === undefined || s.trim() === '';
}

/**
 * Compose the file table the engine sees: user files plus a synthetic
 * `ReplShell.tsx`, plus an entry stub when the user's entry is blank.
 *
 * Shell resolution:
 *   1. User dropped `ReplShell.tsx` into `files` → keep theirs (visible in
 *      tabs, edited like any other file).
 *   2. `customShell` is a string → inject it under `ReplShell.tsx`.
 *   3. Otherwise → inject the generated default — a pass-through that just
 *      renders the entry component.
 *
 * Entry fallback: when `files[entry]` is missing or whitespace-only, an
 * `App() => null` stub is injected at the entry path. Source-level errors
 * in a non-empty entry are left alone — those flow through swc and surface
 * as transform errors. The stub is engine-side only; consumers see their
 * `files` map untouched (no `onFilesChange` bleed, editor still shows the
 * empty buffer).
 */
export function withShellFile(files: Files, entry: string, customShell: string | undefined): Files {
  let next = files;
  if (isBlankSource(files[entry])) {
    next = { ...next, [entry]: ENTRY_FALLBACK_SOURCE };
  }
  if (!(SHELL_PATH in next)) {
    next = { ...next, [SHELL_PATH]: customShell ?? buildDefaultShellSource(entry) };
  }
  return next;
}

/**
 * Pass-through shell: imports the entry module and renders it. Strips the
 * extension so `resolveRelative` can match `.tsx` / `.ts` / `.jsx` / `.js`
 * — the consumer's entry might be any of those, even though `App.tsx` is
 * the default.
 */
export function buildDefaultShellSource(entry: string): string {
  const stem = entry.replace(/\.[^.]+$/, '');
  return `import Entry from './${stem}'\nexport default function ReplShell() { return <Entry /> }\n`;
}
