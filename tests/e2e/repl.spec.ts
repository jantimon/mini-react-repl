/**
 * E2E suite for mini-react-repl. Runs against examples/e2e-fixture and drives
 * the REPL the way a user does — clicking accessible file tabs, editing the
 * active file, deleting files — then asserts on what the user sees: the
 * rendered preview and the in-iframe error overlay.
 */

import { test, expect } from '@playwright/test';
import {
  preview,
  gotoFixture,
  openFile,
  setEditorText,
  addFile,
  expectOverlay,
  expectNoOverlay,
} from './support/editor';

test.describe('mini-react-repl', () => {
  test('cold render: hello-world appears', async ({ page }) => {
    await gotoFixture(page);
    await expect(preview(page).getByRole('heading', { name: /Today is/i })).toBeVisible();
    await expect(preview(page).getByRole('button', { name: /count:/ })).toBeVisible();
  });

  test('edit App.tsx → preview updates', async ({ page }) => {
    await gotoFixture(page);

    await setEditorText(
      page,
      'App.tsx',
      `export default function App() {
  return <h1>edited</h1>;
}
`,
    );

    await expect(preview(page).getByRole('heading', { name: 'edited' })).toBeVisible();
  });

  test('Fast Refresh preserves useState across edits', async ({ page }) => {
    await gotoFixture(page);

    const counter = preview(page).getByRole('button', { name: /count:/ });
    await counter.click();
    await counter.click();
    await counter.click();
    await expect(counter).toHaveText('count: 3');

    // Edit Counter.tsx but keep the component identity + hooks intact, so Fast
    // Refresh re-renders without resetting state. Only the label changes.
    await openFile(page, 'Counter.tsx');
    await setEditorText(
      page,
      'Counter.tsx',
      `import { useState } from 'react';

export function Counter() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN((x) => x + 1)}>tally: {n}</button>;
}
`,
    );

    // Same state (3) survives the edit; the new label proves the edit applied.
    await expect(preview(page).getByRole('button', { name: 'tally: 3' })).toBeVisible();
  });

  test('importing a missing module surfaces a Module not found overlay', async ({ page }) => {
    await gotoFixture(page);

    // Editing the entry to import a file that doesn't exist forces a recompile
    // whose resolution fails — the user's typical "Module not found" case.
    await setEditorText(
      page,
      'App.tsx',
      `import './does-not-exist';

export default function App() {
  return <h1>broken</h1>;
}
`,
    );

    await expectOverlay(page, /Module not found/i);
    // Last-good render stays mounted behind the overlay.
    await expect(preview(page).getByRole('heading', { name: /Today is/i })).toBeVisible();
  });

  test('syntax error keeps last-good render mounted', async ({ page }) => {
    await gotoFixture(page);
    await expect(preview(page).getByRole('button', { name: /count:/ })).toBeVisible();

    await openFile(page, 'Counter.tsx');
    await setEditorText(page, 'Counter.tsx', `export function Counter() { return <div>oops`);

    await expectOverlay(page, /Transform error/i);
    // The previous successful render is still on screen behind the overlay.
    await expect(preview(page).getByRole('button', { name: /count:/ })).toBeVisible();
  });

  test('runtime error surfaces in the overlay and via onPreviewError', async ({ page }) => {
    await gotoFixture(page);

    await setEditorText(
      page,
      'App.tsx',
      `export default function App() {
  throw new Error('boom from user code');
}
`,
    );

    await expectOverlay(page, /Runtime error/i);
    // The `onPreviewError` prop also fires; the fixture echoes its kind into a
    // host log region, so this guards the callback contract (distinct from the
    // runtime's own in-preview overlay above).
    await expect(page.getByRole('log')).toHaveText('preview error: runtime');
  });

  test('iframeRef forwards to <iframe>; host can postMessage in', async ({ page }) => {
    await gotoFixture(page);

    const messageBox = page.getByRole('textbox', { name: 'Message to preview' });
    const send = page.getByRole('button', { name: 'Send to preview' });
    const inbox = preview(page).getByRole('status');

    await messageBox.fill('hello-from-host');
    await send.click();
    await expect(inbox).toContainText('hello-from-host');

    // A second post overwrites — confirms the listener stays mounted.
    await messageBox.fill('round-two');
    await send.click();
    await expect(inbox).toContainText('round-two');
  });

  test('JS importing a sibling CSS file applies styles without a resolve error', async ({
    page,
  }) => {
    await gotoFixture(page);

    // Add a CSS file via the real "Add file" control, fill it, then have
    // App.tsx import it. Before the fix, the compiled blob still contained
    // `import './App.css'`, which the browser can't resolve against a blob:
    // URL ("Invalid relative url or base scheme isn't hierarchical").
    await addFile(page, 'App.css');
    await setEditorText(page, 'App.css', `h1 { color: rgb(123, 45, 67); }`);

    await openFile(page, 'App.tsx');
    await setEditorText(
      page,
      'App.tsx',
      `import './App.css'
export default function App() {
  return <h1>styled</h1>
}
`,
    );

    const styled = preview(page).getByRole('heading', { name: 'styled' });
    await expect(styled).toBeVisible();
    await expect(styled).toHaveCSS('color', 'rgb(123, 45, 67)');
    await expectNoOverlay(page);
  });
});
