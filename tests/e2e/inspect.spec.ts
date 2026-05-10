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
    // the data attribute the picker sets on enable.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const iframe = document.querySelector('iframe.repl-iframe') as HTMLIFrameElement | null;
            return (
              iframe?.contentDocument?.documentElement?.hasAttribute('data-repl-inspect-active') ??
              false
            );
          }),
        { timeout: 5_000 },
      )
      .toBe(true);

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
});
