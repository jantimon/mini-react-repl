/**
 * E2E test for the `mini-react-repl/inspect` subpath. Drives the demo's
 * `<InspectMode/>` toggle via the `__replTest__` window hooks, clicks an
 * element inside the live iframe, and asserts the resulting `ElementPick`
 * carries the expected source-mapped JSX call site.
 */

import { test, expect, type Page } from '@playwright/test';

type StackFrame = {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
  componentName: string | null;
};

type ElementPick = {
  dom: { tag: string; text: string | null };
  stack: StackFrame[];
};

declare global {
  interface Window {
    __lastPick?: ElementPick;
  }
}

async function gotoDemo(page: Page) {
  await page.goto('/?test');
  await page.waitForFunction(() => Boolean(window.__replTest__));
}

function preview(page: Page) {
  return page.frameLocator('.repl-iframe');
}

test.describe('mini-react-repl/inspect', () => {
  test('clicking the seed h1 yields a source-mapped pick', async ({ page }) => {
    await gotoDemo(page);
    const h1 = preview(page).locator('h1');
    await expect(h1).toContainText(/Today is/i, { timeout: 30_000 });

    // Reset any leftover pick from prior tests in the same context.
    await page.evaluate(() => {
      delete window.__lastPick;
      window.__replTest__.setInspectActive(true);
    });

    // Wait until the picker has actually installed its capture-phase click
    // handler in the iframe — easiest signal: the documentElement carries
    // the data attribute the picker sets on enable. Read inside the iframe
    // because `iframe.contentDocument` is null under sandbox="allow-scripts".
    await expect(preview(page).locator('html')).toHaveAttribute(
      'data-repl-inspect-active',
      '',
      { timeout: 5_000 },
    );

    await h1.click();

    // The picker decodes the source map asynchronously and posts the pick
    // back; the demo stashes it on `window.__lastPick`.
    await expect
      .poll(() => page.evaluate(() => window.__lastPick?.dom?.tag ?? null), { timeout: 5_000 })
      .toBe('h1');

    const pick = await page.evaluate(() => window.__lastPick);
    expect(pick).toBeTruthy();
    expect(pick!.dom.tag).toBe('h1');
    expect(pick!.dom.text).toMatch(/Today is/);

    // The seed `App.tsx` opens its `<h1>` on line 7 of the user source.
    // Source-map decoding should land us on that line; React 19's
    // _debugStack frame carries the JSX call-site position so the line
    // can be exact, while the column reflects the JSX `<` in source space.
    expect(pick!.stack.length).toBeGreaterThan(0);
    const top = pick!.stack[0]!;
    expect(top.fileName).toBe('App.tsx');
    expect(top.lineNumber).toBe(7);
    expect(top.componentName).toBe('App');
  });

  test('overlay reappears after a pick deactivates inspect', async ({ page }) => {
    // Regression guard: every activation cycle is a fresh overlay element
    // (the previous one fades out + removes after disable). If the second-
    // cycle overlay ever fails to paint, this test catches it.
    await gotoDemo(page);
    const h1 = preview(page).locator('h1');
    const counter = preview(page).locator('[data-testid="counter"]');
    await expect(h1).toContainText(/Today is/i, { timeout: 30_000 });

    const readOverlay = async () => {
      const ov = preview(page).locator('[data-repl-inspect-overlay]');
      if ((await ov.count()) === 0) return null;
      return ov.evaluate((el) => {
        const e = el as HTMLElement;
        const cs = getComputedStyle(e);
        return {
          opacity: e.style.opacity,
          display: cs.display,
          backgroundColor: cs.backgroundColor,
          boxShadow: cs.boxShadow,
          width: e.style.width,
        };
      });
    };

    // First cycle: enable → hover → click. The pick auto-disables inspect.
    await page.evaluate(() => {
      delete window.__lastPick;
      window.__replTest__.setInspectActive(true);
    });
    await h1.hover();
    await expect
      .poll(async () => (await readOverlay())?.opacity ?? null, { timeout: 5_000 })
      .toBe('1');
    await h1.click();
    await expect
      .poll(() => page.evaluate(() => window.__lastPick?.dom?.tag ?? null), { timeout: 5_000 })
      .toBe('h1');

    // Second cycle: re-enable, hover a DIFFERENT element so we get a fresh
    // mousemove that lands on a fiber-bearing target (h1's lastTarget was
    // cleared on disable, but counter forces a distinct enter event).
    await page.evaluate(() => window.__replTest__.setInspectActive(true));
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
    await gotoDemo(page);
    const h1 = preview(page).locator('h1');
    await expect(h1).toContainText(/Today is/i, { timeout: 30_000 });

    await page.evaluate(() => window.__replTest__.setInspectActive(true));
    await expect(preview(page).locator('html')).toHaveAttribute(
      'data-repl-inspect-active',
      '',
      { timeout: 5_000 },
    );

    await h1.hover();

    // Read the overlay from the inline style (set deterministically by the
    // picker after the show-delay timer fires) plus the computed background
    // and shadow. `getComputedStyle().opacity` would interpolate during the
    // CSS fade and produce values like "0.43" mid-transition — the inline
    // value flips cleanly from "0" to "1".
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

    // The picker waits ~100ms after hover before flipping opacity to "1"
    // (the no-flash delay). Poll up to 5s, well past that.
    await expect
      .poll(async () => (await readOverlay())?.opacity ?? null, { timeout: 5_000 })
      .toBe('1');

    const overlayStyle = await readOverlay();
    // If `ensureOverlay` short-circuits before applying defaults, both
    // `backgroundColor` and `boxShadow` come back at the UA defaults
    // ("rgba(0, 0, 0, 0)" / "none") — invisible despite a correctly-sized
    // box. The bug this test guards against.
    expect(overlayStyle!.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(overlayStyle!.boxShadow).not.toBe('none');
    expect(overlayStyle!.width).not.toBe('');
  });
});
