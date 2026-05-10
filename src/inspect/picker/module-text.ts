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
};

type ReplWindow = Window & {
  __repl__?: { modules?: Map<string, ModuleRecordLike> };
};

/**
 * Look up the compiled module text for `path`. Returns `undefined` if the
 * runtime hasn't booted yet or the module isn't registered.
 */
export function getModuleRecord(path: string): ModuleRecordLike | undefined {
  const repl = (window as ReplWindow).__repl__;
  return repl?.modules?.get(path);
}
