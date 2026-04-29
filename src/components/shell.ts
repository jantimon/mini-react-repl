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
 * Compose the file table the engine sees: user files plus a synthetic
 * `ReplShell.tsx`. Resolution order:
 *
 *   1. User dropped `ReplShell.tsx` into `files` → keep theirs (visible in
 *      tabs, edited like any other file).
 *   2. `customShell` is a string → inject it under `ReplShell.tsx`.
 *   3. Otherwise → inject the generated default — a pass-through that just
 *      renders the entry component.
 */
export function withShellFile(files: Files, entry: string, customShell: string | undefined): Files {
  if (SHELL_PATH in files) return files;
  const source = customShell ?? buildDefaultShellSource(entry);
  return { ...files, [SHELL_PATH]: source };
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
