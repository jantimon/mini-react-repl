/**
 * Logical-path helpers. Files use a flat namespace (no folders), but imports
 * use `./Name` and `./Name.tsx` syntax. These helpers normalize both.
 *
 * @internal
 */

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/**
 * Resolve a relative specifier (`./Counter`, `./Counter.tsx`, `./styles.css`)
 * against a containing module's logical path.
 *
 * Returns the logical path of the target if it exists in `files`, or `null`.
 * Tries the literal name first, then each known extension.
 */
export function resolveRelative(specifier: string, files: Record<string, string>): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('/')) return null;
  const stripped = specifier.replace(/^\.\//, '').replace(/^\//, '');

  if (files[stripped] !== undefined) return stripped;
  for (const ext of EXTENSIONS) {
    if (files[stripped + ext] !== undefined) return stripped + ext;
  }
  return null;
}

/** Returns the language hint for an editor adapter. */
export function languageFor(path: string): 'typescript' | 'javascript' | 'css' {
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
  return 'typescript';
}

/** Whether a path is a transform target (TS/TSX/JS/JSX, not CSS). */
export function isCodeFile(path: string): boolean {
  return /\.(tsx?|jsx?)$/.test(path);
}

/** Whether a path is a CSS file. */
export function isCssFile(path: string): boolean {
  return path.endsWith('.css');
}

/**
 * Split a bare specifier into its top-level package name and the subpath that
 * follows. A scope keeps both segments (`@mui/material/styles` → `@mui/material`
 * + `/styles`); a trailing-slash prefix mapping collapses to its package
 * (`react-dom/` → `react-dom` + `/`); a bare package has an empty subpath
 * (`react` → `react` + `''`).
 */
export function splitSpecifier(specifier: string): { packageName: string; subpath: string } {
  // For a scope the package name spans two segments — skip past the first
  // slash before looking for the one that begins the subpath.
  const subpathSearchStart = specifier.startsWith('@') ? specifier.indexOf('/') + 1 : 0;
  const slash = specifier.indexOf('/', subpathSearchStart);
  if (slash === -1) return { packageName: specifier, subpath: '' };
  return { packageName: specifier.slice(0, slash), subpath: specifier.slice(slash) };
}
