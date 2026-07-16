/**
 * E2E for `hmr={false}`, against examples/readonly-preview. The swc `refresh`
 * flag and the runtime's `data-hmr` read only exist in a real browser, so this
 * is the only place they're covered — the unit suite stops at the seams.
 */

import { test, expect } from '@playwright/test';

const READONLY_URL = 'http://localhost:5177/';

/** The sandboxed preview document. */
function preview(page: import('@playwright/test').Page) {
  return page.frameLocator('.repl-iframe');
}

async function gotoReadonly(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(READONLY_URL);
  await expect(preview(page).getByRole('heading', { name: 'Counter' })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('read-only preview (hmr={false})', () => {
  test('cold render: the preview boots with no Refresh runtime present', async ({ page }) => {
    await gotoReadonly(page);
    await expect(preview(page).getByRole('button', { name: /count:/ })).toBeVisible();
  });

  test('compiled user code carries no Refresh plumbing', async ({ page }) => {
    // The compiled module IS the artifact this prop changes, and the runtime
    // already stashes it for the inspect picker. Nothing user-facing differs
    // (stack traces are identical either way — Refresh registrations run at
    // module scope, never on the throw path), so this reads the seam directly
    // rather than asserting a difference that isn't observable.
    await gotoReadonly(page);
    const sources = await preview(page)
      .locator('html')
      .evaluate(() => {
        const repl = (window as unknown as { __repl__: { modules: Map<string, unknown> } })
          .__repl__;
        return [...repl.modules.values()].map(
          (rec) => (rec as { compiledSource: string | null }).compiledSource ?? '',
        );
      });

    expect(sources.length).toBeGreaterThan(0);
    const joined = sources.join('\n');
    // With Refresh on, swc emits these into every component module.
    expect(joined).not.toContain('$RefreshReg$');
    expect(joined).not.toContain('$RefreshSig$');
    // The commit epilogue still runs — it's what marks the module evaluated.
    expect(joined).toContain('window.__repl__.commit(');
  });

  test('picking another example re-boots the preview', async ({ page }) => {
    await gotoReadonly(page);
    await page.getByRole('tab', { name: 'Greeting' }).click();

    await expect(preview(page).getByRole('heading', { name: 'Greeting' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(preview(page).getByText('hello, world')).toBeVisible();
  });

  test('a re-boot does not preserve state, unlike Fast Refresh', async ({ page }) => {
    await gotoReadonly(page);
    await preview(page)
      .getByRole('button', { name: /count:/ })
      .click();
    await expect(preview(page).getByRole('button', { name: 'count: 1' })).toBeVisible();

    // Round-trip through the other example and back: the counter remounts from
    // scratch. This is the documented trade-off of turning Fast Refresh off.
    await page.getByRole('tab', { name: 'Greeting' }).click();
    await expect(preview(page).getByRole('heading', { name: 'Greeting' })).toBeVisible();
    await page.getByRole('tab', { name: 'Counter' }).click();

    await expect(preview(page).getByRole('button', { name: 'count: 0' })).toBeVisible({
      timeout: 30_000,
    });
  });
});
