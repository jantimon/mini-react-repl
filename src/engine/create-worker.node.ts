/**
 * Node stub for the transform-worker constructor, selected by the `node`
 * condition of the `#create-worker` entry in package.json `imports`.
 *
 * Keeps `new Worker(new URL('./worker.js', import.meta.url))` and the swc
 * wasm glue out of server bundles entirely — see `create-worker.ts` for the
 * full rationale. Throwing (rather than a no-op) is intentional: the worker
 * only boots from `TransformClient.prewarm()` / session attach, which are
 * client-side effects, so reaching this on a server is a real bug worth a
 * loud message.
 *
 * @internal
 */

export function createTransformWorker(): Worker {
  throw new Error(
    'mini-react-repl: the transform worker is browser-only. ' +
      'TransformClient.prewarm()/attachSession() must not run during SSR — ' +
      'call them from client-side effects.',
  );
}
