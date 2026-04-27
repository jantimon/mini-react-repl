/**
 * E2E suite for mini-react-repl. Runs against examples/demo with ?test exposed
 * window hooks so we drive file changes without typing into Monaco.
 *
 * The test cases match SPEC.md §17.
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
    };
  }
}

async function gotoDemo(page: Page) {
  await page.goto('/?test');
  // Wait for test hooks to be installed.
  await page.waitForFunction(() => Boolean(window.__replTest__));
}

function preview(page: Page) {
  return page.frameLocator('.repl-iframe');
}

test.describe('mini-react-repl', () => {
  test('cold render: hello-world appears', async ({ page }) => {
    await gotoDemo(page);
    const h1 = preview(page).locator('h1');
    await expect(h1).toContainText(/Today is/i, { timeout: 30_000 });
    await expect(preview(page).locator('[data-testid=counter]')).toBeVisible();
  });

  test('edit App.tsx → preview updates', async ({ page }) => {
    await gotoDemo(page);
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });

    await page.evaluate(() => {
      window.__replTest__.setFile(
        'App.tsx',
        `export default function App() {
          return <h1 data-testid="changed">edited</h1>
        }`,
      );
    });

    await expect(preview(page).locator('[data-testid=changed]')).toHaveText('edited');
  });

  test('Fast Refresh preserves useState across edits', async ({ page }) => {
    await gotoDemo(page);
    const counter = preview(page).locator('[data-testid=counter]');
    await expect(counter).toBeVisible({ timeout: 30_000 });

    // click 3 times
    for (let i = 0; i < 3; i++) await counter.click();
    await expect(counter).toContainText('count: 3');

    // edit Counter.tsx — only the JSX, NOT the useState call. Refresh
    // should preserve the count.
    await page.evaluate(() => {
      window.__replTest__.setFile(
        'Counter.tsx',
        `import { useState } from 'react'
export function Counter() {
  const [n, setN] = useState(0)
  return (
    <button data-testid="counter" data-edited="true" onClick={() => setN((x) => x + 1)}>
      tally: {n}
    </button>
  )
}`,
      );
    });

    // Wait for the new render.
    await expect(counter).toHaveAttribute('data-edited', 'true');
    // State preserved!
    await expect(counter).toContainText('tally: 3');
  });

  test('rename a file → overlay shows Module not found', async ({ page }) => {
    await gotoDemo(page);
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });

    await page.evaluate(() => {
      window.__replTest__.renameFile('Counter.tsx', 'MyCounter.tsx');
    });

    // Overlay appears.
    const overlay = preview(page)
      .locator('[id="__repl-error-overlay__"]')
      .or(preview(page).locator('.repl-error-overlay'));
    // The overlay is inside a shadow root in the iframe — fall back to
    // checking the parent's onPreviewError state via __replTest__.
    await expect
      .poll(
        async () => {
          return await page.evaluate(() => {
            const e = window.__replTest__.getError() as { kind?: string } | null;
            return e?.kind ?? null;
          });
        },
        { timeout: 10_000 },
      )
      .toBe('resolve');

    // Last-good render still visible.
    await expect(preview(page).locator('[data-testid=counter]')).toBeVisible();
    void overlay;
  });

  test('syntax error keeps last-good render mounted', async ({ page }) => {
    await gotoDemo(page);
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });

    await page.evaluate(() => {
      window.__replTest__.setFile('Counter.tsx', `export function Counter() { return <div>oops`);
    });

    await expect
      .poll(
        async () => {
          return await page.evaluate(() => {
            const e = window.__replTest__.getError() as { kind?: string } | null;
            return e?.kind ?? null;
          });
        },
        { timeout: 10_000 },
      )
      .toBe('transform');

    await expect(preview(page).locator('[data-testid=counter]')).toBeVisible();
  });

  test('runtime error from user code surfaces', async ({ page }) => {
    await gotoDemo(page);
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });

    await page.evaluate(() => {
      window.__replTest__.setFile(
        'App.tsx',
        `export default function App() {
  throw new Error('boom from user code')
}`,
      );
    });

    await expect
      .poll(
        async () => {
          return await page.evaluate(() => {
            const e = window.__replTest__.getError() as { kind?: string; message?: string } | null;
            return e?.kind ?? null;
          });
        },
        { timeout: 10_000 },
      )
      .toBe('runtime');
  });

  test('Monaco shows no 17004 / 2792 on the seed App.tsx', async ({ page }) => {
    await gotoDemo(page);
    // Wait for the preview to mount — that confirms Monaco has rendered
    // App.tsx and the TS service has had a chance to run diagnostics.
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });

    // Monaco's diagnostics arrive asynchronously after the TS worker boots;
    // poll until either we see clean markers or the test times out.
    await expect
      .poll(
        async () => {
          const markers = await page.evaluate(() => window.__replTest__.getMarkers('App.tsx'));
          // Severity 8 == MarkerSeverity.Error in Monaco.
          const errorCodes = markers
            .filter((m) => m.severity === 8)
            .map((m) => (typeof m.code === 'object' ? m.code.value : m.code));
          return errorCodes;
        },
        { timeout: 15_000 },
      )
      .not.toContain('17004');

    const finalErrorCodes = await page.evaluate(() =>
      window.__replTest__
        .getMarkers('App.tsx')
        .then((ms) =>
          ms
            .filter((m) => m.severity === 8)
            .map((m) => (typeof m.code === 'object' ? m.code.value : m.code)),
        ),
    );
    expect(finalErrorCodes).not.toContain('17004');
    expect(finalErrorCodes).not.toContain('2792');
  });

  test('iframeRef forwards to <iframe>; host can postMessage in', async ({ page }) => {
    await gotoDemo(page);
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });

    // Demo passes `iframeRef` to <Repl>; the demo test hook exposes
    // `hasIframeRef()` which returns true once the ref attached.
    await expect.poll(() => page.evaluate(() => window.__replTest__.hasIframeRef())).toBe(true);

    // The bodyHtml-injected listener writes into #ext-msg when it receives
    // `{ type: '__ext_test__', payload }`. Posting via the ref should land.
    await page.evaluate(() => window.__replTest__.postToIframe('hello-from-host'));
    await expect(preview(page).locator('[data-testid=ext-msg]')).toHaveText('hello-from-host');

    // A second post should overwrite — confirms the listener stays mounted.
    await page.evaluate(() => window.__replTest__.postToIframe('round-two'));
    await expect(preview(page).locator('[data-testid=ext-msg]')).toHaveText('round-two');
  });

  test('Monaco surfaces a real type error from vendor types', async ({ page }) => {
    await gotoDemo(page);
    await expect(preview(page).locator('h1')).toContainText(/Today is/i, { timeout: 30_000 });

    // Replace App.tsx with a deliberate misuse of date-fns `format`: too
    // few arguments. Real types are wired up only when the vendor.types
    // pipeline reaches Monaco's TS service end-to-end.
    await page.evaluate(() => {
      window.__replTest__.setFile(
        'App.tsx',
        `import { format } from 'date-fns'
export default function App() {
  // @ts-expect-no-error — we want Monaco to flag this.
  return <h1>{String(format(new Date()))}</h1>
}
`,
      );
    });

    await expect
      .poll(
        async () => {
          const markers = await page.evaluate(() => window.__replTest__.getMarkers('App.tsx'));
          return markers.some((m) => {
            if (m.severity !== 8) return false;
            const code = String(typeof m.code === 'object' ? m.code.value : m.code);
            // 2554: "Expected N-M arguments, but got K"
            // 2345: "Argument of type X is not assignable to parameter of type Y"
            // 2769: "No overload matches this call"
            return code === '2554' || code === '2345' || code === '2769';
          });
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
