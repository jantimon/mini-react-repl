/**
 * Shared e2e helpers that drive the REPL the way a user does — clicking the
 * accessible file tabs, typing into Monaco, and reading the visible error
 * overlay — instead of reaching into app internals via window backdoors.
 */

import { expect, type FrameLocator, type Page } from '@playwright/test';

// The Monaco adapter hangs its namespace off the editor's container node
// (`.repl-editor-monaco`) in dev/test builds — guarded by NODE_ENV in
// src/editor-monaco/index.tsx. Reaching it through the DOM (rather than a
// `window` global) keeps tests querying the page the same way everywhere, and
// means no example app carries any test-only code. It's the single editor seam
// tests use: replacing file contents and reading TS diagnostics.
const EDITOR = '.repl-editor-monaco';
type MonacoHandle = typeof import('monaco-editor');

/** The sandboxed preview document. */
export function preview(page: Page): FrameLocator {
  return page.frameLocator('.repl-iframe');
}

/** Open the e2e-fixture demo (baseURL) and wait for the seed to render. */
export async function gotoFixture(page: Page): Promise<void> {
  await page.goto('/');
  await expect(preview(page).getByRole('heading', { name: /Today is/i })).toBeVisible({
    timeout: 30_000,
  });
}

/** Click a file tab by its filename and wait until it's the active tab. */
export async function openFile(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Replace the contents of `path`'s editor model. Driven through Monaco's own
 * `model.setValue`, which fires the identical `onDidChangeModelContent →
 * onChange → onFilesChange → recompile` path a keystroke does — so it
 * exercises the real edit pipeline (the thing under test) without depending on
 * Monaco's flaky keystroke/selection handling (which is Monaco's concern, not
 * the library's).
 *
 * Only the file shown in the editor recompiles on edit — the adapter's
 * `onChange` listens to the *active* model, while background files sync
 * one-way (host → Monaco). So this resolves the model by URI and asserts it's
 * the active tab, throwing a clear error otherwise rather than silently
 * editing whichever file happens to be open. Call `openFile(path)` first for
 * anything other than the default-active entry (`App.tsx`).
 */
export async function setEditorText(page: Page, path: string, source: string): Promise<void> {
  await page.locator(EDITOR).evaluate(
    (el, { src, p }) => {
      const monaco = (el as unknown as { __monaco__?: MonacoHandle }).__monaco__;
      if (!monaco) {
        throw new Error('__monaco__ is not on the editor node — the adapter must run in dev mode');
      }
      const model = monaco.editor.getEditors()[0]?.getModel();
      if (!model) throw new Error('no active Monaco model to edit');
      const want = monaco.Uri.parse(`file:///workspace/${p}`).toString();
      if (model.uri.toString() !== want) {
        throw new Error(
          `editor is showing ${model.uri.path}, not /workspace/${p} — call openFile('${p}') first`,
        );
      }
      model.setValue(src);
    },
    { src: source, p: path },
  );
}

/**
 * Create a new file via the real "Add file" control. The tabs use a built-in
 * `window.prompt` for the name, so we answer the dialog before clicking.
 */
export async function addFile(page: Page, name: string): Promise<void> {
  page.once('dialog', (dialog) => dialog.accept(name));
  await page.getByRole('button', { name: 'Add file' }).click();
  await expect(page.getByRole('tab', { name })).toBeVisible();
}

/**
 * Assert the in-preview error overlay is showing and matches. The overlay
 * carries role="alert" and lives in an open shadow root, which Playwright
 * locators pierce through the iframe boundary.
 */
export async function expectOverlay(page: Page, text: string | RegExp): Promise<void> {
  await expect(preview(page).getByRole('alert')).toContainText(text, { timeout: 30_000 });
}

/** Assert no error overlay is present. */
export async function expectNoOverlay(page: Page): Promise<void> {
  await expect(preview(page).getByRole('alert')).toHaveCount(0);
}

/**
 * Read Monaco's TS diagnostics for a workspace file. Markers have no
 * user-visible text, so we reach the Monaco namespace via the dev-only handle
 * the editor adapter hangs off its container node (`.repl-editor-monaco`).
 */
export async function getMarkers(
  page: Page,
  path: string,
): Promise<Array<{ code?: string | { value: string }; severity: number; message: string }>> {
  return page.locator(EDITOR).evaluate((el, p) => {
    const monaco = (el as unknown as { __monaco__?: MonacoHandle }).__monaco__;
    if (!monaco) {
      throw new Error('__monaco__ is not on the editor node — the adapter must run in dev mode');
    }
    return monaco.editor.getModelMarkers({
      resource: monaco.Uri.parse(`file:///workspace/${p}`),
    });
  }, path);
}
