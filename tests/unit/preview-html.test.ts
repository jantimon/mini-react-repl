import { describe, it, expect } from 'vitest';
import { generatePreviewHtml } from '../../src/preview-html.ts';

describe('preview-html', () => {
  const vendor = {
    importMap: { imports: { react: '/vendor/react.js' } },
  };

  it('contains an import map script', () => {
    const html = generatePreviewHtml({ vendor });
    expect(html).toContain('<script type="importmap">');
    expect(html).toContain('"react":"/vendor/react.js"');
  });

  it('injects headHtml before the import map', () => {
    const html = generatePreviewHtml({
      vendor,
      headHtml: '<meta name="custom" content="x">',
    });
    expect(html.indexOf('<meta name="custom"')).toBeLessThan(
      html.indexOf('<script type="importmap">'),
    );
  });

  it('injects bodyHtml after #root', () => {
    const html = generatePreviewHtml({ vendor, bodyHtml: '<div id="extra"></div>' });
    expect(html.indexOf('id="root"')).toBeLessThan(html.indexOf('id="extra"'));
  });

  it('applies vendor.baseUrl to relative entries only', () => {
    const html = generatePreviewHtml({
      vendor: {
        importMap: {
          imports: {
            react: 'react.js',
            'date-fns': 'https://cdn.example/date-fns.js',
          },
        },
        baseUrl: '/vendor',
      },
    });
    expect(html).toContain('"react":"/vendor/react.js"');
    expect(html).toContain('"date-fns":"https://cdn.example/date-fns.js"');
  });

  it('disables overlay when showErrorOverlay is false', () => {
    const html = generatePreviewHtml({ vendor, showErrorOverlay: false });
    expect(html).toContain('data-overlay="off"');
  });
});
