/**
 * Reads compiled module text out of `window.__repl__.modules`.
 *
 * The picker doesn't import the runtime types — they're not part of the
 * public surface and would couple the bundle to the runtime entry. We
 * declare a structural alias of just the fields the picker reads.
 *
 * @internal
 */

export type ModuleRecordLike = {
  path: string;
  compiledSource: string | null;
  /**
   * Current blob URL for this module, if any. Used as a fallback lookup
   * key: `wrapModuleBody` tags every compiled module with a `//# sourceURL`
   * pragma so V8 and SpiderMonkey report the logical `path` (e.g.
   * `App.tsx`) as the `Error.stack` frame's file — but JavaScriptCore
   * (Safari) does not honor that pragma for ES modules loaded via
   * `import()` of a `blob:` URL, and instead reports the blob URL itself.
   */
  blobUrl?: string | null;
};

type ReplWindow = Window & {
  __repl__?: { modules?: Map<string, ModuleRecordLike> };
};

/**
 * Look up the compiled module text for `path`. Returns `undefined` if the
 * runtime hasn't booted yet or the module isn't registered.
 *
 * Tries a direct lookup by logical path first (the common case, and the
 * only case on engines that honor `//# sourceURL`). If that misses and
 * `path` looks like a blob URL, falls back to a linear scan for the record
 * whose current `blobUrl` matches — this is the Safari case, where the
 * `Error.stack` frame names the blob URL instead of the logical path. The
 * module count is small (open editor files), so the scan cost is
 * negligible and only paid on the fallback path.
 */
export function getModuleRecord(path: string): ModuleRecordLike | undefined {
  const modules = (window as ReplWindow).__repl__?.modules;
  if (!modules) return undefined;
  const direct = modules.get(path);
  if (direct) return direct;
  if (!path.startsWith('blob:')) return undefined;
  for (const rec of modules.values()) {
    if (rec.blobUrl === path) return rec;
  }
  return undefined;
}
