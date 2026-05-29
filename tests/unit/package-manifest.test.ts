import { describe, it, expect } from 'vitest';
import { PackageManifest } from '../../src/engine/package-manifest.ts';

describe('PackageManifest', () => {
  it('extracts the dependencies map', () => {
    const m = new PackageManifest();
    expect(
      m.dependencies(JSON.stringify({ dependencies: { 'canvas-confetti': '1.9.3' } })),
    ).toEqual({ 'canvas-confetti': '1.9.3' });
  });

  it('returns undefined when the source is absent', () => {
    expect(new PackageManifest().dependencies(undefined)).toBeUndefined();
  });

  it('returns undefined for malformed JSON (never throws)', () => {
    const m = new PackageManifest();
    expect(() => m.dependencies('{ not valid json')).not.toThrow();
    expect(m.dependencies('{ not valid json')).toBeUndefined();
  });

  it('returns undefined when there is no dependencies object', () => {
    expect(new PackageManifest().dependencies(JSON.stringify({ name: 'x' }))).toBeUndefined();
  });

  it('drops non-string dependency entries', () => {
    const m = new PackageManifest();
    expect(m.dependencies(JSON.stringify({ dependencies: { good: '1.0.0', bad: 5 } }))).toEqual({
      good: '1.0.0',
    });
  });

  it('returns the same parsed object for identical source (cached)', () => {
    const m = new PackageManifest();
    const source = JSON.stringify({ dependencies: { lodash: '4.17.21' } });
    expect(m.dependencies(source)).toBe(m.dependencies(source));
  });

  it('re-parses when the source changes', () => {
    const m = new PackageManifest();
    expect(m.dependencies(JSON.stringify({ dependencies: { lodash: '4.0.0' } }))).toEqual({
      lodash: '4.0.0',
    });
    expect(m.dependencies(JSON.stringify({ dependencies: { lodash: '4.17.21' } }))).toEqual({
      lodash: '4.17.21',
    });
  });
});
