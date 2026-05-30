/**
 * E2E for examples/virtual-modules — exercises the runtime-substitution path
 * for inline virtual modules. The seed code imports `greet` from `@foo/bar`,
 * which itself imports `exclaim` from `@foo/utils` (cross-virtual). The
 * cold-render assertion proves topo order; the hot-edit assertion proves the
 * substitution stays valid across `syncFiles` updates.
 */

import { test, expect } from '@playwright/test';
import { preview, setEditorText } from './support/editor';

const URL_BASE = 'http://localhost:5175/';

test.describe('virtual-modules demo', () => {
  test('cold render resolves cross-virtual imports', async ({ page }) => {
    await page.goto(URL_BASE);

    await expect(preview(page).getByRole('heading', { name: 'hello world!' })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('hot edit re-resolves the virtual alias', async ({ page }) => {
    await page.goto(URL_BASE);
    await expect(preview(page).getByRole('heading', { name: 'hello world!' })).toBeVisible({
      timeout: 30_000,
    });

    await setEditorText(
      page,
      'App.tsx',
      `import { greet } from '@foo/bar';

export default function App() {
  return <h1>{greet('claude')}</h1>;
}
`,
    );

    await expect(preview(page).getByRole('heading', { name: 'hello claude!' })).toBeVisible();
  });
});
