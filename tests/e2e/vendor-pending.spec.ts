/**
 * E2E for the promise-typed `vendor` prop pending-state contract added in
 * 0.13.0: <ReplProvider/> renders children immediately, <ReplPreview/> shows
 * a sized placeholder, and the iframe mounts once the promise resolves.
 *
 * Driven via the fixture's `?slowVendor` mode, whose vendor promise gates on a
 * `/__vendor-gate__` request that Playwright holds, then answers 200 (resolve)
 * or 503 (reject) — see ./support/vendor.
 */

import { test, expect, type ConsoleMessage } from '@playwright/test';
import { preview } from './support/editor';
import { installVendorGate } from './support/vendor';

test.describe('vendor pending state', () => {
  test('placeholder shows while promise pending; iframe mounts on resolve', async ({ page }) => {
    const gate = await installVendorGate(page);
    await page.goto('/?slowVendor');
    await gate.requested;

    // Placeholder div renders immediately while vendor resolves. Distinct class
    // from the real iframe so frameLocator only matches once it mounts.
    const placeholder = page.locator('div.repl-iframe-placeholder');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveAttribute('aria-busy', 'true');

    // The real iframe is NOT in the DOM yet.
    await expect(page.locator('iframe.repl-iframe')).toHaveCount(0);

    // File tabs render during the pending window — proof that <ReplProvider/>
    // no longer null-renders its children.
    await expect(page.locator('.repl-tabs')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(3); // App.tsx + Counter.tsx + Inbox.tsx

    // Resolve the vendor promise; <ReplPreview/> swaps placeholder for iframe.
    gate.resolve();

    await expect(placeholder).toHaveCount(0);
    await expect(page.locator('iframe.repl-iframe')).toHaveCount(1);

    await expect(preview(page).getByRole('heading', { name: /Today is/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(preview(page).getByRole('button', { name: /count:/ })).toBeVisible();
  });

  test('rejected vendor promise keeps placeholder and logs a diagnostic', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const gate = await installVendorGate(page);
    await page.goto('/?slowVendor');
    await gate.requested;

    const placeholder = page.locator('div.repl-iframe-placeholder');
    await expect(placeholder).toBeVisible();

    gate.reject();

    // Provider has nothing to latch — placeholder stays, iframe never mounts.
    await expect(placeholder).toBeVisible();
    await expect(page.locator('iframe.repl-iframe')).toHaveCount(0);

    // The rejection surfaces a console diagnostic instead of a silent spinner,
    // and forwards the underlying reason ('vendor gate failed' — thrown by the
    // fixture on the 503) rather than swallowing it behind a generic message.
    await expect
      .poll(() => errors.find((t) => t.includes('vendor promise rejected')) ?? null)
      .toContain('vendor gate failed');
  });
});
