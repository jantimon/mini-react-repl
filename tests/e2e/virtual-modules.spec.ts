/**
 * E2E for examples/virtual-modules — exercises the runtime-substitution path
 * for inline virtual modules. The seed code imports `greet` from `@foo/bar`,
 * which itself imports `exclaim` from `@foo/utils` (cross-virtual). The
 * cold-render assertion proves topo order; the hot-edit assertion proves the
 * substitution stays valid across `syncFiles` updates.
 */

import { test, expect, type Page } from '@playwright/test';

const URL_BASE = 'http://localhost:5175/';

function preview(page: Page) {
  return page.frameLocator('.repl-iframe');
}

test.describe('virtual-modules demo', () => {
  test('cold render resolves cross-virtual imports', async ({ page }) => {
    await page.goto(URL_BASE);

    const greeting = preview(page).locator('[data-testid=greeting]');
    await expect(greeting).toBeVisible({ timeout: 30_000 });
    await expect(greeting).toHaveText('hello world!');
  });

  test('hot edit re-resolves the virtual alias', async ({ page }) => {
    await page.goto(`${URL_BASE}?test`);
    await page.waitForFunction(() => Boolean((window as { __replTest__?: unknown }).__replTest__));

    const greeting = preview(page).locator('[data-testid=greeting]');
    await expect(greeting).toHaveText('hello world!', { timeout: 30_000 });

    await page.evaluate(() => {
      (
        window as unknown as { __replTest__: { setFile: (p: string, s: string) => void } }
      ).__replTest__.setFile(
        'App.tsx',
        `import { greet } from '@foo/bar';

export default function App() {
  return <h1 data-testid="greeting">{greet('claude')}</h1>;
}
`,
      );
    });

    await expect(greeting).toHaveText('hello claude!');
  });
});
