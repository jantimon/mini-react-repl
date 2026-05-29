/**
 * esm.sh resolver for the `<Repl cdn={...} />` prop — lazy-loads any published
 * npm package on demand, layered behind the prebuilt `vendor` import map.
 *
 * Why a factory rather than a hard-wired resolver: the singleton guarantee
 * (see below) depends on per-deployment config — which versions to pin, which
 * packages to allow, which esm.sh flags to set — and the resolver must be a
 * *stable reference* so the provider doesn't tear down its session on a parent
 * re-render. Build it once at module scope, pass the result as `cdn`.
 *
 * The React singleton, in one line: every emitted URL carries
 * `?external=<vendor keys>`, which tells esm.sh to emit bare `import "react"`
 * (etc.) instead of bundling its own copy. Those bare imports resolve through
 * the iframe's import map to the one `data:` React the vendor serves — so the
 * lazy package shares the exact same React instance as everything else, and
 * hooks don't cross an instance boundary into "Invalid hook call". The host
 * passes the vendor keys in as `sharedDependencies`; we forward them verbatim.
 *
 * @public
 */

import type { ReplCdnResolver } from './types.ts';
import { splitSpecifier } from './engine/path-utils.ts';

export type EsmShOptions = {
  /**
   * Origin to resolve against. Point at a self-hosted esm.sh mirror or a
   * pinned esm.sh build for high-trust or air-gapped deployments.
   * @defaultValue `'https://esm.sh'`
   */
  origin?: string;
  /**
   * Pin versions for reproducibility: bare package name → semver range. These
   * are authoritative — they win over any `dependencies` declared in a
   * `package.json` in the REPL's file table. Packages pinned by neither fall
   * to esm.sh's default (latest), which can drift between sessions, so pin
   * anything you ship publicly. A REPL `package.json` covers the rest and lets
   * users pin from inside the editor.
   * @example `{ 'canvas-confetti': '1.9.3' }`
   */
  versions?: Record<string, string>;
  /**
   * Allowlist gate. When provided, only specifiers it returns `true` for
   * resolve via esm.sh; everything else returns `null` (and surfaces as the
   * normal unresolved-module error). Omit to allow every bare specifier the
   * vendor map doesn't already cover.
   */
  allow?: (specifier: string) => boolean;
  /**
   * Extra esm.sh query flags. Boolean `true` emits a valueless flag
   * (`?bundle`); a string emits `name=value` (the value URL-encoded);
   * `false` omits the flag.
   * @example `{ bundle: true, target: 'es2022' }`
   */
  query?: Record<string, string | boolean>;
};

/**
 * Build a {@link ReplCdnResolver} backed by esm.sh. Call once at module scope
 * and pass the result as the `cdn` prop:
 *
 * ```tsx
 * import { createEsmShCdnHandler } from 'mini-react-repl/cdn-esmsh';
 *
 * // Stable reference — created once, never on re-render.
 * const cdnHandler = createEsmShCdnHandler({ versions: { 'canvas-confetti': '1.9.3' } });
 *
 * function Playground() {
 *   return <Repl vendor={defaultVendor} cdn={cdnHandler} … />;
 * }
 * ```
 */
export function createEsmShCdnHandler(options: EsmShOptions = {}): ReplCdnResolver {
  const origin = options.origin ?? 'https://esm.sh';

  return function resolveViaEsmSh(specifier, sharedDependencies, _fromPath, declaredVersions) {
    if (options.allow && !options.allow(specifier)) return null;

    // 'lodash/fp' → packageName 'lodash', subpath '/fp'
    const { packageName, subpath } = splitSpecifier(specifier);
    // Version precedence: the host's explicit `versions` option is authoritative
    // and wins; a `package.json` declared inside the REPL only fills the gaps.
    // Protocol ranges (`workspace:`, `file:`, `npm:`…) aren't esm.sh version
    // specifiers — drop them so a copied-in manifest can't corrupt the URL.
    const declared = declaredVersions?.[packageName];
    const usableDeclared = declared && !declared.includes(':') ? declared : undefined;
    const pinnedVersion = options.versions?.[packageName] ?? usableDeclared;
    const version = pinnedVersion ? `@${pinnedVersion}` : '';

    // Build the query string by hand rather than via URLSearchParams: the
    // latter percent-encodes commas and slashes, turning the canonical
    // `?external=react,react-dom,react/jsx-runtime` into `%2C`/`%2F` soup
    // we'd be betting esm.sh decodes the same way. esm.sh URLs use raw
    // commas and slashes — keep them verbatim.
    const params: string[] = [];
    // The singleton guarantee: tell esm.sh to leave everything the vendor
    // already serves as a bare import, so it resolves through our import map
    // instead of being bundled a second time.
    if (sharedDependencies.length > 0) {
      params.push(`external=${sharedDependencies.join(',')}`);
    }
    for (const [flagName, flagValue] of Object.entries(options.query ?? {})) {
      if (flagValue === false) continue;
      // Encode string values — unlike the deliberately-raw `external` list
      // above, arbitrary flag values may contain reserved characters (`&`,
      // spaces) that would otherwise corrupt the query string.
      params.push(flagValue === true ? flagName : `${flagName}=${encodeURIComponent(flagValue)}`);
    }

    const queryString = params.join('&');
    return `${origin}/${packageName}${version}${subpath}${queryString ? `?${queryString}` : ''}`;
  };
}
