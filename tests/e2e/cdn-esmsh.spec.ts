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

import { test, expect } from '@playwright/test';
import { preview, setEditorText } from './support/editor';

const URL_BASE = 'http://localhost:5176/';

// esm.sh ships already-compiled JS, so the stubs use `createElement`, not JSX.
// The confetti stub renders a visible status node so the test can confirm the
// lazily-imported module actually executed — no test-only data attribute.
const CONFETTI_STUB = `export default function confetti() {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = 'confetti fired';
  document.body.appendChild(el);
}`;

const WIDGET_STUB = `import { createElement, useState } from "react";
export default function Widget() {
  const [n, setN] = useState(7);
  return createElement(
    "button",
    { onClick: () => setN(n + 1) },
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
    await page.goto(URL_BASE);
  });

  test('lazy-loads a CDN module that is not in the vendor set', async ({ page }) => {
    const button = preview(page).getByRole('button', { name: /fired/ });
    await expect(button).toHaveText('🎉 fired 0×', { timeout: 30_000 });

    // Clicking runs the lazily-imported esm.sh module (the confetti stub) and
    // re-renders via the host's React.
    await button.click();
    await expect(button).toHaveText('🎉 fired 1×');
    await expect(preview(page).getByRole('status')).toHaveText('confetti fired');
  });

  test('a CDN module shares the host React singleton', async ({ page }) => {
    // Wait for the cold render so Monaco has mounted the seed before we edit.
    await expect(preview(page).getByRole('button', { name: /fired/ })).toBeVisible({
      timeout: 30_000,
    });

    // Edit App.tsx to import a hook-using component from a CDN-only package.
    // It renders iff our React is the one its bare `import "react"` resolved
    // to (otherwise: "Invalid hook call").
    await setEditorText(
      page,
      'App.tsx',
      `import Widget from 'cdn-widget';

export default function App() {
  return <Widget />;
}
`,
    );

    const widget = preview(page).getByRole('button', { name: /^cdn:/ });
    await expect(widget).toHaveText('cdn:7', { timeout: 30_000 });
  });
});
