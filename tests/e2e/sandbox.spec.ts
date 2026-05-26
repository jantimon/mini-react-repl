/**
 * E2E coverage for the iframe sandbox boundary.
 *
 * The default `sandbox="allow-scripts"` makes the iframe cross-origin to the
 * embedder, so user code cannot reach `window.parent.document`. These tests
 * assert both halves: the attribute is on the iframe, and an attack from
 * inside the iframe cannot mutate the parent page.
 */

import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __replTest__: {
      setFile: (path: string, source: string) => void;
      removeFile: (path: string) => void;
      renameFile: (oldPath: string, newPath: string) => void;
      reset: () => void;
      getError: () => unknown;
      getMarkers: (
        path: string,
      ) => Promise<Array<{ code?: string | { value: string }; severity: number; message: string }>>;
      postToIframe: (payload: unknown) => boolean;
      hasIframeRef: () => boolean;
      setInspectActive: (next: boolean) => void;
      getLastPick: () => unknown;
    };
  }
}

async function gotoDemo(page: Page) {
  await page.goto('/?test');
  await page.waitForFunction(() => Boolean(window.__replTest__));
}

function preview(page: Page) {
  return page.frameLocator('.repl-iframe');
}

test.describe('iframe sandbox', () => {
  test('default sandbox attributes', async ({ page }) => {
    await gotoDemo(page);
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });
    await expect(page.locator('iframe.repl-iframe')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms',
    );
    await expect(page.locator('iframe.repl-iframe')).toHaveAttribute('allow', '');
    await expect(page.locator('iframe.repl-iframe')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  test('user code cannot mutate window.parent.document', async ({ page }) => {
    await gotoDemo(page);
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });

    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.evaluate(() => {
      window.__replTest__.setFile(
        'App.tsx',
        `export default function App() {
           window.parent.document.body.style.background = 'rgb(255, 0, 0)';
           return <h1 data-testid="attacked">attacked</h1>;
         }`,
      );
    });

    // Wait for the runtime error so we know user code actually executed —
    // otherwise the parent-unchanged assertion below would pass vacuously.
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () => (window.__replTest__.getError() as { kind?: string } | null)?.kind ?? null,
          ),
        { timeout: 10_000 },
      )
      .toBe('runtime');

    const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(after).toBe(before);
  });
});
