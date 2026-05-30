/**
 * E2E for examples/custom-vendor — exercises the full custom-vendor pipeline
 * (vendor.ts → repl-vendor-build → import-map.json → iframe runtime). The
 * seed code in the iframe imports nanoid from the import map and renders a
 * list whose row ids come from `nanoid()`; we drive the UI to confirm the
 * bundle works at runtime.
 */

import { test, expect } from '@playwright/test';
import { preview } from './support/editor';

const CUSTOM_VENDOR_URL = 'http://localhost:5174/';

test.describe('custom-vendor demo', () => {
  test('nanoid generates ids for added items', async ({ page }) => {
    await page.goto(CUSTOM_VENDOR_URL);

    // Wait for the iframe to mount and the seed UI to render. Generous
    // timeout — first paint waits on swc-wasm + vendor bundle fetches.
    const textbox = preview(page).getByRole('textbox');
    await expect(textbox).toBeVisible({ timeout: 30_000 });
    const addButton = preview(page).getByRole('button', { name: 'add' });

    await textbox.fill('first');
    await addButton.click();

    await textbox.fill('second');
    await addButton.click();

    const items = preview(page).getByRole('listitem');
    await expect(items).toHaveCount(2);

    // Each row's id comes from nanoid() — rendered in its <code> element.
    const first = (await items.nth(0).locator('code').textContent()) ?? '';
    const second = (await items.nth(1).locator('code').textContent()) ?? '';
    expect(first).not.toEqual('');
    expect(second).not.toEqual('');
    expect(first).not.toEqual(second);
  });
});
