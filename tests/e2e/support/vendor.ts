/**
 * Drives the e2e-fixture's `?slowVendor` mode. That mode makes the `vendor`
 * prop a promise that resolves only after a `/__vendor-gate__` request settles,
 * so a test can hold the request to observe the pending state, then fulfill it
 * (vendor resolves) or fail it (vendor rejects) — all via `page.route`, with
 * no window hooks in the example.
 */

import type { Page } from '@playwright/test';

export type VendorGate = {
  /** Resolves once the example has issued the gate request (vendor pending). */
  requested: Promise<void>;
  /** Fulfill the gate so the vendor promise resolves and the iframe mounts. */
  resolve: () => void;
  /**
   * Answer the gate with a 503 so the fixture's `.then` throws — the vendor
   * promise rejects with a recognizable message the diagnostic forwards. A
   * real HTTP failure (not `route.abort`) keeps the reason deterministic
   * instead of relying on the browser's network-error wording.
   */
  reject: () => void;
};

export async function installVendorGate(page: Page): Promise<VendorGate> {
  let markRequested!: () => void;
  const requested = new Promise<void>((r) => {
    markRequested = r;
  });
  let decide!: (action: 'resolve' | 'reject') => void;
  const decided = new Promise<'resolve' | 'reject'>((r) => {
    decide = r;
  });

  await page.route('**/__vendor-gate__', async (route) => {
    markRequested();
    const action = await decided;
    if (action === 'resolve') {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
    } else {
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'gate rejected' });
    }
  });

  return {
    requested,
    resolve: () => decide('resolve'),
    reject: () => decide('reject'),
  };
}
