/**
 * E2E for examples/custom-vendor — exercises the full custom-vendor pipeline
 * (vendor.ts → repl-vendor-build → import-map.json → iframe runtime). The
 * seed code in the iframe imports nanoid from the import map and renders a
 * list whose row ids come from `nanoid()`; we drive the UI to confirm the
 * bundle works at runtime.
 */

import { test, expect, type Page } from '@playwright/test';

const CUSTOM_VENDOR_URL = 'http://localhost:5174/';

function preview(page: Page) {
  return page.frameLocator('.repl-iframe');
}

test.describe('custom-vendor demo', () => {
  test('nanoid generates ids for added items', async ({ page }) => {
    await page.goto(CUSTOM_VENDOR_URL);

    // Wait for the iframe to mount and the seed UI to render. Generous
    // timeout — first paint waits on swc-wasm + vendor bundle fetches.
    const text = preview(page).locator('[data-testid=text]');
    await expect(text).toBeVisible({ timeout: 30_000 });

    await text.fill('first');
    await preview(page).locator('[data-testid=add]').click();

    await text.fill('second');
    await preview(page).locator('[data-testid=add]').click();

    const items = preview(page).locator('[data-testid=item]');
    await expect(items).toHaveCount(2);

    const ids = preview(page).locator('[data-testid=item-id]');
    const first = (await ids.nth(0).textContent()) ?? '';
    const second = (await ids.nth(1).textContent()) ?? '';
    expect(first).not.toEqual('');
    expect(second).not.toEqual('');
    expect(first).not.toEqual(second);
  });
});
