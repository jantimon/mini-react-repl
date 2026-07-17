/**
 * Vendor bundles ship as multi-MB `data:` URLs, which Firefox re-escapes on
 * every stack/location capture. The preview re-hosts them as short `blob:`
 * URLs before declaring the import map.
 */

import { test, expect } from '@playwright/test';
import { preview, gotoFixture } from './support/editor';

// A re-hosted entry is a `blob:` URL (~46 chars). The unfixed `react-dom/client`
// data: URL is ~1.3 M — anything near that is the bug coming back.
const MAX_SANE_URL_LENGTH = 200;

test.describe('vendor module URLs', () => {
  test('the import map declares short blob: URLs, not megabyte data: ones', async ({ page }) => {
    await gotoFixture(page);

    const map = await preview(page)
      .locator('script[type="importmap"]')
      .evaluate((el) => JSON.parse(el.textContent ?? '{}'));

    const urls: string[] = [
      ...Object.values(map.imports ?? {}),
      ...Object.values(map.scopes ?? {}).flatMap((scope) => Object.values(scope as object)),
    ];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toMatch(/^data:/);
      expect(url.length).toBeLessThan(MAX_SANE_URL_LENGTH);
    }
  });

  test('React still renders through the re-hosted vendor modules', async ({ page }) => {
    await gotoFixture(page);
    await expect(preview(page).getByRole('button', { name: /count:/ })).toBeVisible();
  });
});
