/**
 * White-box guard for the editor's TypeScript diagnostics — the one editor
 * behavior with no user-visible text to assert on (a squiggle's error code
 * isn't queryable). Markers are read through the dev-only Monaco handle the
 * adapter hangs off its container node (see tests/e2e/support/editor.ts).
 *
 * The pair guards both failure directions:
 *   - no FALSE POSITIVES on valid code: 17004 ("JSX needs --jsx") and 2792
 *     ("cannot find module") must be absent, proving the compiler options and
 *     vendor-types wiring are correct.
 *   - no FALSE NEGATIVES: a genuine misuse of a vendor API must surface (2554 /
 *     2345 / 2769), proving the vendor `.d.ts` are actually loaded and
 *     type-checking is live — not silently disabled.
 */

import { test, expect } from '@playwright/test';
import { gotoFixture, setEditorText, getMarkers } from './support/editor';

// Mirrors Monaco's `MarkerSeverity.Error` (8). Hardcoded rather than imported
// because pulling the monaco-editor enum into the Playwright (Node) runner
// would drag in browser-only module code.
const MARKER_SEVERITY_ERROR = 8;

async function errorCodes(page: Parameters<typeof getMarkers>[0], path: string): Promise<string[]> {
  const markers = await getMarkers(page, path);
  return markers
    .filter((m) => m.severity === MARKER_SEVERITY_ERROR)
    .map((m) => String(typeof m.code === 'object' && m.code ? m.code.value : m.code));
}

test.describe('editor TypeScript diagnostics', () => {
  test('no false-positive 17004 / 2792 markers on the valid seed App.tsx', async ({ page }) => {
    await gotoFixture(page);

    // Diagnostics arrive asynchronously after the TS worker boots; poll until
    // the JSX false positive is gone, then assert both codes are absent.
    await expect
      .poll(() => errorCodes(page, 'App.tsx'), { timeout: 15_000 })
      .not.toContain('17004');

    const codes = await errorCodes(page, 'App.tsx');
    expect(codes).not.toContain('17004');
    expect(codes).not.toContain('2792');
  });

  test('surfaces a real type error from vendor types', async ({ page }) => {
    await gotoFixture(page);

    // Misuse dayjs `format` (a number where it wants a string template). The
    // error only appears if the vendor.types pipeline reached Monaco's TS
    // service end-to-end.
    await setEditorText(
      page,
      'App.tsx',
      `import dayjs from 'dayjs'
export default function App() {
  return <h1>{String(dayjs().format(123))}</h1>
}
`,
    );

    await expect
      .poll(
        async () => {
          const codes = await errorCodes(page, 'App.tsx');
          return codes.some((c) => c === '2554' || c === '2345' || c === '2769');
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
