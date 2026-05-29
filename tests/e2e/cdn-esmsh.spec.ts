/**
 * E2E for examples/cdn-esmsh — exercises the opt-in `cdn` resolver that
 * lazy-loads bare specifiers the vendor map doesn't cover from esm.sh.
 *
 * Network-free: every `https://esm.sh/**` request is fulfilled by Playwright's
 * `page.route`, which intercepts at the browser-context level (CDP
 * `Fetch.enable`) and therefore catches requests even from the cross-origin,
 * sandboxed preview iframe. The fulfilled response MUST carry
 * `Access-Control-Allow-Origin: *` and a JS content type, or the opaque-origin
 * CORS module fetch fails.
 *
 * The singleton test serves a stub that imports bare `react` and calls a hook:
 * that bare import resolves through the preview's own import map, so if our
 * vendor React weren't shared with the esm.sh module it would throw "Invalid
 * hook call" and never render. A successful render is the assertion.
 */

import { test, expect, type Page } from '@playwright/test';

const URL_BASE = 'http://localhost:5176/';

function preview(page: Page) {
  return page.frameLocator('.repl-iframe');
}

// esm.sh ships already-compiled JS, so the stubs use `createElement`, not JSX.
const CONFETTI_STUB = `export default function confetti() {
  document.body.setAttribute('data-confetti-fired', 'true');
}`;

const WIDGET_STUB = `import { createElement, useState } from "react";
export default function Widget() {
  const [n, setN] = useState(7);
  return createElement(
    "button",
    { "data-testid": "cdn-widget", onClick: () => setN(n + 1) },
    "cdn:" + n,
  );
}`;

test.describe('cdn-esmsh demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://esm.sh/**', (route) => {
      const isWidget = route.request().url().includes('/cdn-widget');
      return route.fulfill({
        contentType: 'text/javascript',
        headers: { 'access-control-allow-origin': '*' },
        body: isWidget ? WIDGET_STUB : CONFETTI_STUB,
      });
    });
  });

  test('lazy-loads a CDN module that is not in the vendor set', async ({ page }) => {
    await page.goto(URL_BASE);

    const button = preview(page).locator('[data-testid=confetti]');
    await expect(button).toHaveText('🎉 fired 0×', { timeout: 30_000 });

    // Clicking runs the lazily-imported esm.sh module (the confetti stub) and
    // re-renders via the host's React.
    await button.click();
    await expect(button).toHaveText('🎉 fired 1×');
    await expect(preview(page).locator('body')).toHaveAttribute('data-confetti-fired', 'true');
  });

  test('a CDN module shares the host React singleton', async ({ page }) => {
    await page.goto(`${URL_BASE}?test`);
    await page.waitForFunction(() => Boolean((window as { __replTest__?: unknown }).__replTest__));

    // Swap in code that imports a hook-using component from a CDN-only
    // package. It renders iff our React is the one its bare `import "react"`
    // resolved to.
    await page.evaluate(() => {
      (
        window as unknown as { __replTest__: { setFile: (p: string, s: string) => void } }
      ).__replTest__.setFile(
        'App.tsx',
        `import Widget from 'cdn-widget';

export default function App() {
  return <Widget />;
}
`,
      );
    });

    const widget = preview(page).locator('[data-testid=cdn-widget]');
    await expect(widget).toHaveText('cdn:7', { timeout: 30_000 });
  });
});
