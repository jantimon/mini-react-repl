/**
 * Guard against the boot-path waterfall that motivated the 0.16.0 refactor.
 *
 * The four engine assets — `types-*.js` (types JSON chunk),
 * `import-map-*.js` (import-map JSON chunk), `worker.js`, and
 * `wasm_bg.wasm` — must all start downloading at `<ReplPreview/>` mount,
 * not chain on each other. Without slowdown, dev responses complete in
 * <1ms and the ordering is invisible; we add a fixed per-URL delay via
 * `page.route()` so a "starts before the other finishes" assertion is
 * meaningful.
 *
 * Two scenarios:
 *   1. sync vendor — all four overlap.
 *   2. Promise vendor (`?slowVendor`) — `worker.js` + `wasm_bg.wasm` issue
 *      while the vendor promise is still pending. This is the load-bearing
 *      guarantee of the refactor: prewarm fires from a `useEffect` on
 *      `<ReplPreviewInner/>` mount, independent of vendor resolution.
 */

import { test, expect, type Page, type Request } from '@playwright/test';
import { preview } from './support/editor';
import { installVendorGate } from './support/vendor';

type Kind = 'types' | 'importMap' | 'worker' | 'wasm';

/**
 * Map a request URL to one of the four kinds we track, or null otherwise.
 * The `/dist/worker.js` pattern is specific enough to skip Monaco's own
 * `editor.worker.js` / `ts.worker.js` without an extra exclusion.
 */
function classify(url: string): Kind | null {
  // Vite emits a `?import&url` probe alongside the real WASM fetch; the
  // probe is what `import swcWasmUrl from '...?url'` resolves to. We only
  // want the worker's actual `fetch(wasmUrl)` call, which has no query.
  if (url.includes('wasm_bg.wasm') && !url.includes('?import')) return 'wasm';
  // The default-vendor chunks emitted by tsup look like `types-XYZ.js` and
  // `import-map-XYZ.js`. Match the leading segment plus the `-` separator
  // so user filenames containing `types` don't accidentally trigger.
  if (/\/types-[A-Z0-9]+\.js(\?.*)?$/i.test(url)) return 'types';
  if (/\/import-map-[A-Z0-9]+\.js(\?.*)?$/i.test(url)) return 'importMap';
  if (/\/dist\/worker(\.[a-z0-9]+)?\.js(\?.*)?$/i.test(url)) return 'worker';
  return null;
}

type Capture = {
  requestedAt: number;
  finishedAt: number | null;
};

type FinishedCapture = Capture & { finishedAt: number };

/**
 * TS assertion helper: narrows a captured request to `FinishedCapture`
 * (both present and finished) in one call, so call sites can read
 * `.requestedAt` / `.finishedAt` without non-null bangs.
 */
function assertFinished(cap: Capture | undefined, kind: Kind): asserts cap is FinishedCapture {
  if (!cap) throw new Error(`expected a ${kind} request but none was captured`);
  if (cap.finishedAt === null) {
    throw new Error(`${kind} request never finished before assertions ran`);
  }
}

/**
 * Per-kind delays. Vendor chunks get a much longer delay than the worker
 * pair so that `wasm.requestedAt < importMap.finishedAt` carries margin
 * (the wasm fetch can only start once `worker.js` has loaded — that 300 ms
 * gap is inherent and not a regression).
 *
 *   worker.js   ── 300 ms → wasm fetch ── 300 ms → done (~600 ms)
 *   importMap   ── 1500 ms ──────────────────────→ done
 *   types       ── 1500 ms ──────────────────────→ done
 *
 * Slack of 200 ms absorbs the few-ms timing jitter inside the route handler.
 */
const DELAYS_MS: Record<Kind, number> = {
  worker: 300,
  wasm: 300,
  importMap: 1500,
  types: 1500,
};
const SLACK_MS = 200;

/**
 * Delay ONLY the four boot-asset URLs we track. A global CDP throttle
 * would also slow Monaco's multi-MB payload and blow past Playwright's
 * timeout; route-level delay scopes the slowdown to the requests under
 * test, leaving everything else at full dev-server speed.
 */
async function delayBootAssets(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const kind = classify(route.request().url());
    if (kind) {
      await new Promise((resolve) => setTimeout(resolve, DELAYS_MS[kind]));
    }
    await route.continue();
  });
}

function trackBootRequests(page: Page): Map<Kind, Capture> {
  const captures = new Map<Kind, Capture>();
  page.on('request', (req: Request) => {
    const kind = classify(req.url());
    if (!kind || captures.has(kind)) return;
    captures.set(kind, { requestedAt: Date.now(), finishedAt: null });
  });
  page.on('requestfinished', (req: Request) => {
    const kind = classify(req.url());
    if (!kind) return;
    const entry = captures.get(kind);
    if (entry && entry.finishedAt === null) entry.finishedAt = Date.now();
  });
  return captures;
}

test.describe('boot assets load in parallel, not in a waterfall', () => {
  // Throttling stretches each chunk fetch into a visible window, so the
  // whole boot takes longer than the default 30s per-test budget.
  test.setTimeout(90_000);

  test('sync vendor: types, import-map, worker.js, wasm all overlap', async ({ page }) => {
    await delayBootAssets(page);
    const captures = trackBootRequests(page);

    // `waitUntil: 'commit'` returns once navigation is committed, without
    // waiting for the `load` event — under throttling that takes longer
    // than the page's 30s default budget. We then drive the test by
    // waiting for the iframe-rendered <h1> instead.
    await page.goto('/', { waitUntil: 'commit' });

    // Wait for the iframe app to render so we know all four kinds were
    // requested AND finished (we need their finish timestamps below).
    await expect(preview(page).getByRole('heading', { name: /Today is/i })).toBeVisible({
      timeout: 60_000,
    });

    const types = captures.get('types');
    const importMap = captures.get('importMap');
    const worker = captures.get('worker');
    const wasm = captures.get('wasm');
    assertFinished(types, 'types');
    assertFinished(importMap, 'importMap');
    assertFinished(worker, 'worker');
    assertFinished(wasm, 'wasm');

    // (1) `types`, `importMap`, `worker.js` should all issue at preview-
    // mount time — within a tight window of each other, not chained.
    const earlyStarts = [types.requestedAt, importMap.requestedAt, worker.requestedAt];
    expect(
      Math.max(...earlyStarts) - Math.min(...earlyStarts),
      'types / importMap / worker should all issue together at preview mount',
    ).toBeLessThan(SLACK_MS);

    // (2) `wasm` is fetched by the worker once it boots, so it legitimately
    // starts after `worker.js` finishes — but must not also wait for the
    // vendor chunks. Margin = importMap.delay - worker.delay - wasm.delay.
    expect(
      wasm.requestedAt,
      'wasm must start before import-map chunk finishes (only worker.js is a real dep)',
    ).toBeLessThan(importMap.finishedAt - SLACK_MS);
    expect(wasm.requestedAt, 'wasm must start before types chunk finishes').toBeLessThan(
      types.finishedAt - SLACK_MS,
    );

    // (3) The worker fetches wasm immediately after its own load completes;
    // any large gap would mean wasm was queued behind something else.
    expect(
      wasm.requestedAt - worker.finishedAt,
      'wasm should be requested promptly after worker.js loads',
    ).toBeLessThan(SLACK_MS);
  });

  test('promise vendor: worker.js + wasm load while vendor promise is still pending', async ({
    page,
  }) => {
    await delayBootAssets(page);
    // Register the gate AFTER the delay route so it wins for the gate URL.
    const gate = await installVendorGate(page);
    const captures = trackBootRequests(page);

    await page.goto('/?slowVendor', { waitUntil: 'commit' });
    await gate.requested; // the vendor promise is now pending

    // The engine should prewarm without waiting for the vendor promise.
    await expect.poll(() => Boolean(captures.get('worker')), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => Boolean(captures.get('wasm')), { timeout: 15_000 }).toBe(true);

    // Critically: the vendor chunks are only accessed once the promise
    // resolves, so they must NOT have been requested yet.
    expect(
      captures.get('types'),
      'types chunk must not load while vendor promise is pending',
    ).toBeUndefined();
    expect(
      captures.get('importMap'),
      'import-map chunk must not load while vendor promise is pending',
    ).toBeUndefined();

    // Resolve and let the full boot complete — proves the rest still wires
    // up correctly after the prewarmed worker is reused for the session.
    gate.resolve();
    await expect(preview(page).getByRole('heading', { name: /Today is/i })).toBeVisible({
      timeout: 60_000,
    });
  });
});
