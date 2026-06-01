import { describe, it, expect } from 'vitest';
import { generatePreviewHtml } from '../../src/preview-html.ts';

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
});
