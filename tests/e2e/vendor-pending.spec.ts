/**
 * E2E for the promise-typed `vendor` prop pending-state contract added in
 * 0.13.0: <ReplProvider/> renders children immediately, <ReplPreview/> shows
 * a sized placeholder, and the iframe mounts once the promise resolves.
 *
 * Driven via the fixture's `?slowVendor` hook (see `examples/e2e-fixture/src/App.tsx`)
 * which builds a never-resolved promise and exposes `window.__resolveVendor`
 * / `window.__rejectVendor` so we drive the transition deterministically.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

declare global {
  interface Window {
    __resolveVendor?: () => void;
    __rejectVendor?: (msg?: string) => void;
  }
}

async function gotoPending(page: Page) {
  await page.goto('/?test&slowVendor');
  // Wait until the slow-vendor hooks are installed on window so the test
  // can drive resolution without racing the React mount.
  await page.waitForFunction(() => typeof window.__resolveVendor === 'function');
}

test.describe('vendor pending state', () => {
  test('placeholder shows while promise pending; iframe mounts on resolve', async ({ page }) => {
    await gotoPending(page);

    // Placeholder div renders immediately while vendor resolves. Uses a
    // distinct class from the real iframe so frameLocator selectors only
    // match the real iframe once it mounts.
    const placeholder = page.locator('div.repl-iframe-placeholder');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveAttribute('aria-busy', 'true');

    // The real iframe is NOT in the DOM yet.
    await expect(page.locator('iframe.repl-iframe')).toHaveCount(0);

    // File tabs / editor host should render during the pending window —
    // proof that <ReplProvider/> no longer null-renders its children.
    await expect(page.locator('.repl-tabs')).toBeVisible();
    await expect(page.locator('.repl-tabs .repl-tab')).toHaveCount(2); // App.tsx + Counter.tsx

    // Resolve the vendor promise. Provider latches the bundle and
    // <ReplPreview/> swaps the placeholder for the real iframe.
    await page.evaluate(() => window.__resolveVendor!());

    await expect(placeholder).toHaveCount(0);
    await expect(page.locator('iframe.repl-iframe')).toHaveCount(1);

    // Iframe boots and the seed app renders end-to-end.
    const preview = page.frameLocator('iframe.repl-iframe');
    await expect(preview.locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });
    await expect(preview.locator('[data-testid=counter]')).toBeVisible();
  });

  test('rejected vendor promise keeps placeholder and logs a diagnostic', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await gotoPending(page);

    const placeholder = page.locator('div.repl-iframe-placeholder');
    await expect(placeholder).toBeVisible();

    await page.evaluate(() => window.__rejectVendor!('boom'));

    // Provider has nothing to latch — placeholder stays, iframe never mounts.
    await expect(placeholder).toBeVisible();
    await expect(page.locator('iframe.repl-iframe')).toHaveCount(0);

    // The new console.error path surfaces the rejection so consumers see
    // *something* in the console instead of a silent forever-spinner.
    await expect
      .poll(() => errors.find((t) => t.includes('vendor promise rejected')))
      .toContain('boom');
  });
});
