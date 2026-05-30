/**
 * E2E coverage for the iframe sandbox boundary.
 *
 * The default `sandbox="allow-scripts"` makes the iframe cross-origin to the
 * embedder, so user code cannot reach `window.parent.document`. These tests
 * assert both halves: the attribute is on the iframe, and an attack from
 * inside the iframe cannot mutate the parent page.
 */

import { test, expect, type Page } from '@playwright/test';
import { preview, setEditorText, expectOverlay } from './support/editor';

async function gotoDemo(page: Page) {
  await page.goto('/');
  await expect(preview(page).getByRole('heading', { name: /Today is/i })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('iframe sandbox', () => {
  test('default sandbox attributes', async ({ page }) => {
    await gotoDemo(page);
    await expect(page.locator('iframe.repl-iframe')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms',
    );
    await expect(page.locator('iframe.repl-iframe')).toHaveAttribute('allow', '');
    await expect(page.locator('iframe.repl-iframe')).toHaveAttribute(
      'referrerpolicy',
      'no-referrer',
    );
  });

  test('preview document is delivered via blob: URL, not srcdoc', async ({ page }) => {
    await gotoDemo(page);

    const iframe = page.locator('iframe.repl-iframe');
    await expect(iframe).toHaveAttribute('src', /^blob:/);
    // srcdoc is omitted entirely (vs. being present and empty)
    expect(await iframe.getAttribute('srcdoc')).toBeNull();
  });

  test('user code cannot mutate window.parent.document', async ({ page }) => {
    await gotoDemo(page);

    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await setEditorText(
      page,
      'App.tsx',
      `export default function App() {
         window.parent.document.body.style.background = 'rgb(255, 0, 0)';
         return <h1>attacked</h1>;
       }`,
    );

    // The cross-origin access throws, surfacing the runtime error overlay —
    // which also proves user code actually executed, so the parent-unchanged
    // assertion below can't pass vacuously.
    await expectOverlay(page, /Runtime error/i);

    const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(after).toBe(before);
  });
});
