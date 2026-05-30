/**
 * E2E test for the `mini-react-repl/inspect` subpath. Drives the demo's real
 * Inspect toggle button, clicks an element inside the live iframe, and asserts
 * the resulting source-mapped pick — surfaced by the demo into a visible
 * status region — carries the expected JSX call site.
 */

import { test, expect } from '@playwright/test';
import { preview, gotoFixture } from './support/editor';

test.describe('mini-react-repl/inspect', () => {
  test('clicking the seed h1 yields a source-mapped pick', async ({ page }) => {
    await gotoFixture(page);
    const h1 = preview(page).getByRole('heading', { name: /Today is/i });

    await page.getByRole('button', { name: 'Inspect' }).click();

    // Wait until the picker has installed its capture-phase click handler in
    // the iframe — its enable signal is the data attribute on the docroot.
    await expect(preview(page).locator('html')).toHaveAttribute('data-repl-inspect-active', '', {
      timeout: 5_000,
    });

    await h1.click();

    // The demo renders the decoded pick into a host status region.
    const pick = page.getByRole('status');
    await expect(pick).toContainText('<h1>');
    await expect(pick).toContainText('Today is');
    // Source-map decoding lands on the App.tsx <h1> (line 8) inside <App>.
    await expect(pick).toContainText('App.tsx:8');
    await expect(pick).toContainText('in App');
  });

  test('overlay reappears after a pick deactivates inspect', async ({ page }) => {
    // Regression guard: every activation cycle is a fresh overlay element (the
    // previous one fades out + removes after disable). If the second-cycle
    // overlay ever fails to paint, this test catches it.
    await gotoFixture(page);
    const h1 = preview(page).getByRole('heading', { name: /Today is/i });
    const counter = preview(page).getByRole('button', { name: /count:/ });

    const readOverlay = async () => {
      // Two overlays can briefly coexist after re-activation: the old one fades
      // out (overlay.ts removes it after FADE_MS) while a fresh element is
      // already appended. `.last()` reads the fresh one without racing the fade.
      const all = preview(page).locator('[data-repl-inspect-overlay]');
      if ((await all.count()) === 0) return null;
      return all.last().evaluate((el) => {
        const e = el as HTMLElement;
        const cs = getComputedStyle(e);
        return {
          opacity: e.style.opacity,
          display: cs.display,
          backgroundColor: cs.backgroundColor,
          boxShadow: cs.boxShadow,
        };
      });
    };

    // First cycle: enable → hover → click. The pick auto-disables inspect.
    await page.getByRole('button', { name: 'Inspect' }).click();
    await h1.hover();
    await expect
      .poll(async () => (await readOverlay())?.opacity ?? null, { timeout: 5_000 })
      .toBe('1');
    await h1.click();
    await expect(page.getByRole('status')).toContainText('<h1>');

    // Second cycle: re-enable, hover a DIFFERENT element so a fresh mousemove
    // lands on a fiber-bearing target and a new overlay paints.
    await page.getByRole('button', { name: 'Inspect' }).click();
    await counter.hover();
    await expect
      .poll(async () => (await readOverlay())?.opacity ?? null, { timeout: 5_000 })
      .toBe('1');
    const overlay = await readOverlay();
    expect(overlay!.display).not.toBe('none');
    expect(overlay!.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(overlay!.boxShadow).not.toBe('none');
  });

  test('hovering shows the default bluish overlay over the target', async ({ page }) => {
    await gotoFixture(page);
    const h1 = preview(page).getByRole('heading', { name: /Today is/i });

    await page.getByRole('button', { name: 'Inspect' }).click();
    await expect(preview(page).locator('html')).toHaveAttribute('data-repl-inspect-active', '', {
      timeout: 5_000,
    });

    await h1.hover();

    // Read the overlay from its inline style (set deterministically after the
    // show-delay) plus computed background/shadow. `getComputedStyle().opacity`
    // would interpolate mid-fade; the inline value flips cleanly "0" → "1".
    const readOverlay = async () => {
      const ov = preview(page).locator('[data-repl-inspect-overlay]');
      if ((await ov.count()) === 0) return null;
      return ov.evaluate((el) => {
        const e = el as HTMLElement;
        const cs = getComputedStyle(e);
        return {
          opacity: e.style.opacity,
          backgroundColor: cs.backgroundColor,
          boxShadow: cs.boxShadow,
          width: e.style.width,
        };
      });
    };

    await expect
      .poll(async () => (await readOverlay())?.opacity ?? null, { timeout: 5_000 })
      .toBe('1');

    const overlayStyle = await readOverlay();
    // If `ensureOverlay` short-circuits before applying defaults, both come
    // back at UA defaults ("rgba(0, 0, 0, 0)" / "none") — invisible despite a
    // correctly-sized box. The bug this test guards against.
    expect(overlayStyle!.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(overlayStyle!.boxShadow).not.toBe('none');
    expect(overlayStyle!.width).not.toBe('');
  });
});
