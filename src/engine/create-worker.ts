/**
 * Browser implementation of the transform-worker constructor.
 *
 * This is the only place the `new Worker(new URL(...), import.meta.url)`
 * pattern appears, and it's deliberately isolated: bundlers resolve that
 * expression statically, so a server-targeted bundle (Next.js app router,
 * Vite `ssr.noExternal`) would otherwise try to compile the worker — and
 * the swc wasm glue inside it — for Node. The `#create-worker` entry in
 * package.json `imports` swaps this file for `create-worker.node.ts` under
 * the `node` condition, so server bundles never see the worker at all.
 *
 * Built to the dist root (see tsup.config.ts) so `./worker.js` resolves to
 * `dist/worker.js`, same as when the expression lived in `dist/index.js`.
 *
 * @internal
 */

export function createTransformWorker(): Worker {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}
