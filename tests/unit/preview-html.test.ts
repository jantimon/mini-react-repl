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
