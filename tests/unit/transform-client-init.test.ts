import { describe, it, expect, vi } from 'vitest';

// The real worker constructor does `new Worker(new URL('./worker.js', ...))`,
// which can't boot in the node test env. Stub the seam and record what the
// client hands it — the worker's own swc config is only reachable via e2e.
const { workers } = vi.hoisted(() => ({ workers: [] as FakeWorker[] }));

type InitPayload = { kind: string; id: number; wasmUrl?: string; hmr?: boolean };

type FakeWorker = {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  posted: InitPayload[];
  postMessage: (msg: InitPayload) => void;
  terminate: () => void;
};

vi.mock('../../src/engine/create-worker.ts', () => ({
  createTransformWorker: () => {
    const worker: FakeWorker = {
      onmessage: null,
      onerror: null,
      posted: [],
      postMessage(msg) {
        worker.posted.push(msg);
        // Complete the handshake so `ensureWorker()` resolves.
        if (msg.kind === 'init') worker.onmessage?.({ data: { kind: 'init-ok', id: msg.id } });
      },
      terminate() {},
    };
    workers.push(worker);
    return worker;
  },
}));

const { TransformClient } = await import('../../src/engine/transform-client.ts');

/** Boot a client against a fresh fake worker and return its init message. */
async function initWith(opts: { hmr?: boolean }): Promise<InitPayload> {
  workers.length = 0;
  const client = new TransformClient(opts);
  const ready = client.ensureWorker();
  // The client sets `onmessage` synchronously inside `ensureWorker`, then
  // waits for the worker to announce itself before sending init.
  workers[0]!.onmessage?.({ data: { kind: 'worker-loaded' } });
  await ready;
  const init = workers[0]!.posted.find((m) => m.kind === 'init');
  if (!init) throw new Error('client never sent an init message');
  client.dispose();
  return init;
}

describe('TransformClient init payload', () => {
  it('forwards hmr: false to the worker', async () => {
    expect(await initWith({ hmr: false })).toMatchObject({ hmr: false });
  });

  it('forwards hmr: true to the worker', async () => {
    expect(await initWith({ hmr: true })).toMatchObject({ hmr: true });
  });

  it('defaults hmr to true when the option is omitted', async () => {
    // A missing flag must not read as "off" — the default is a live REPL.
    expect(await initWith({})).toMatchObject({ hmr: true });
  });
});
