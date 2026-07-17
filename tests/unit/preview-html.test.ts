import { describe, it, expect } from 'vitest';
import { generatePreviewHtml } from '../../src/preview-html.ts';

function countModuleScripts(html: string): number {
  return html.split('<script type="module">').length - 1;
}

describe('preview-html', () => {
  const importMap = { imports: { react: '/vendor/react.js' } };

  it('contains an import map script', () => {
    const html = generatePreviewHtml({ importMap });
    expect(html).toContain('<script type="importmap">');
    expect(html).toContain('"react":"/vendor/react.js"');
  });

  it('escapes < so a specifier cannot break out of the script element', () => {
    const html = generatePreviewHtml({
      importMap: { imports: { evil: '/x.js?</script><img src=x onerror=alert(1)>' } },
    });
    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c/script>');
  });

  it('injects headHtml before the import map', () => {
    const html = generatePreviewHtml({
      importMap,
      headHtml: '<meta name="custom" content="x">',
    });
    expect(html.indexOf('<meta name="custom"')).toBeLessThan(
      html.indexOf('<script type="importmap">'),
    );
  });

  it('injects bodyHtml after #root', () => {
    const html = generatePreviewHtml({ importMap, bodyHtml: '<div id="extra"></div>' });
    expect(html.indexOf('id="root"')).toBeLessThan(html.indexOf('id="extra"'));
  });

  it('emits a <base> before the import map when baseHref is given', () => {
    const html = generatePreviewHtml({ importMap, baseHref: 'https://docs.example.com/' });
    expect(html).toContain('<base href="https://docs.example.com/">');
    expect(html.indexOf('<base ')).toBeLessThan(html.indexOf('<script type="importmap">'));
    expect(html.indexOf('<base ')).toBeLessThan(html.indexOf('<meta name="viewport"'));
  });

  it('omits the <base> tag when baseHref is null', () => {
    const html = generatePreviewHtml({ importMap, baseHref: null });
    expect(html).not.toContain('<base ');
  });

  it('disables overlay when showErrorOverlay is false', () => {
    const html = generatePreviewHtml({ importMap, showErrorOverlay: false });
    expect(html).toContain('data-overlay="off"');
  });

  it('emits the Refresh preamble by default', () => {
    const html = generatePreviewHtml({ importMap });
    expect(html).toContain('preamble');
    expect(html).not.toContain('data-hmr="off"');
  });

  it('drops the Refresh preamble and flags the runtime when hmr is false', () => {
    const html = generatePreviewHtml({ importMap, hmr: false });
    expect(html).toContain('data-hmr="off"');
    expect(html).not.toContain('preamble');
    expect(html).not.toContain('injectIntoGlobalHook');
  });

  it('still emits the runtime script when hmr is false', () => {
    // Only the preamble is conditional — the runtime owns the whole module
    // registry and postMessage protocol, Refresh or not.
    expect(countModuleScripts(generatePreviewHtml({ importMap }))).toBe(2);
    expect(countModuleScripts(generatePreviewHtml({ importMap, hmr: false }))).toBe(1);
  });

  it('combines the overlay and hmr opt-outs without mangling the html tag', () => {
    const html = generatePreviewHtml({ importMap, showErrorOverlay: false, hmr: false });
    expect(html).toContain('<html lang="en" data-overlay="off" data-hmr="off">');
  });
});

/**
 * Which branch `generatePreviewHtml` takes, and what it carries. That the
 * re-hosting itself works is asserted where it can actually run — against
 * real engines in tests/e2e/vendor-urls.spec.ts.
 */
describe('preview-html vendor data: URLs', () => {
  const dataUrl = `data:text/javascript;base64,${btoa('export const x = 1;')}`;

  it('inlines the map as-is when no entry is a data: module', () => {
    const html = generatePreviewHtml({
      importMap: { imports: { react: 'https://esm.sh/react', dayjs: '/vendor/dayjs.js' } },
    });
    expect(html).toContain('<script type="importmap">');
    expect(html).toContain('"react":"https://esm.sh/react"');
  });

  it('re-hosts data: modules at boot instead of inlining the map', () => {
    const html = generatePreviewHtml({ importMap: { imports: { react: dataUrl } } });
    // No static tag survives for the parser — the map is built at boot.
    expect(html).not.toContain('<script type="importmap">');
    expect(html).toContain(dataUrl);
  });

  it('leaves non-data entries alone while re-hosting the data ones', () => {
    const html = generatePreviewHtml({
      importMap: { imports: { react: dataUrl, dayjs: 'https://esm.sh/dayjs' } },
    });
    expect(html).toContain('https://esm.sh/dayjs');
    expect(html).toContain(dataUrl);
  });

  it('takes the re-hosting branch for a data: module hiding under scopes', () => {
    const html = generatePreviewHtml({
      importMap: { imports: { react: '/vendor/react.js' }, scopes: { '/a/': { b: dataUrl } } },
    });
    expect(html).not.toContain('<script type="importmap">');
  });

  it('carries the map ahead of every module script, so it lands before they run', () => {
    const html = generatePreviewHtml({ importMap: { imports: { react: dataUrl } } });
    expect(html.indexOf(dataUrl)).toBeLessThan(html.indexOf('<script type="module">'));
  });

  it('still emits exactly the runtime + preamble module scripts', () => {
    expect(
      countModuleScripts(generatePreviewHtml({ importMap: { imports: { react: dataUrl } } })),
    ).toBe(2);
  });
});
