import { describe, it, expect } from 'vitest';
import {
  resolveRelative,
  languageFor,
  isCodeFile,
  isCssFile,
  splitSpecifier,
} from '../../src/engine/path-utils.ts';

describe('path-utils', () => {
  it('resolves literal name', () => {
    expect(resolveRelative('./Counter.tsx', { 'Counter.tsx': '' })).toBe('Counter.tsx');
  });

  it('tries each extension', () => {
    expect(resolveRelative('./Counter', { 'Counter.tsx': '' })).toBe('Counter.tsx');
    expect(resolveRelative('./helper', { 'helper.ts': '' })).toBe('helper.ts');
  });

  it('returns null for unresolvable', () => {
    expect(resolveRelative('./Nope', { 'App.tsx': '' })).toBeNull();
  });

  it('returns null for bare specifiers', () => {
    expect(resolveRelative('react', { 'App.tsx': '' })).toBeNull();
  });

  it('classifies files correctly', () => {
    expect(languageFor('App.tsx')).toBe('typescript');
    expect(languageFor('App.ts')).toBe('typescript');
    expect(languageFor('app.js')).toBe('javascript');
    expect(languageFor('styles.css')).toBe('css');
    expect(isCodeFile('App.tsx')).toBe(true);
    expect(isCodeFile('styles.css')).toBe(false);
    expect(isCssFile('styles.css')).toBe(true);
  });

  describe('splitSpecifier', () => {
    it('splits a bare package from its subpath', () => {
      expect(splitSpecifier('lodash/fp')).toEqual({ packageName: 'lodash', subpath: '/fp' });
    });

    it('keeps a scoped package name intact', () => {
      expect(splitSpecifier('@mui/material/styles')).toEqual({
        packageName: '@mui/material',
        subpath: '/styles',
      });
    });

    it('returns an empty subpath for a bare package', () => {
      expect(splitSpecifier('react')).toEqual({ packageName: 'react', subpath: '' });
      expect(splitSpecifier('@scope/pkg')).toEqual({ packageName: '@scope/pkg', subpath: '' });
    });

    it('collapses a trailing-slash prefix mapping to its package', () => {
      expect(splitSpecifier('react-dom/')).toEqual({ packageName: 'react-dom', subpath: '/' });
    });
  });
});
