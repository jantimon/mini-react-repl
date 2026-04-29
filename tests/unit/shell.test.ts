import { describe, it, expect } from 'vitest';
import { SHELL_PATH, withShellFile, buildDefaultShellSource } from '../../src/components/shell.ts';

describe('shell', () => {
  describe('buildDefaultShellSource', () => {
    it('strips .tsx and emits a pass-through component', () => {
      const src = buildDefaultShellSource('App.tsx');
      expect(src).toContain(`from './App'`);
      expect(src).toContain('export default function ReplShell()');
      expect(src).toContain('<Entry />');
    });

    it('also strips .ts / .jsx / .js so resolveRelative can pick the right file', () => {
      expect(buildDefaultShellSource('Main.ts')).toContain(`from './Main'`);
      expect(buildDefaultShellSource('Main.jsx')).toContain(`from './Main'`);
      expect(buildDefaultShellSource('main.js')).toContain(`from './main'`);
    });
  });

  describe('withShellFile', () => {
    it('injects the generated default when no shell prop and no user file', () => {
      const out = withShellFile({ 'App.tsx': '...' }, 'App.tsx', undefined);
      expect(out[SHELL_PATH]).toBeDefined();
      expect(out[SHELL_PATH]).toContain(`from './App'`);
      // user files preserved
      expect(out['App.tsx']).toBe('...');
    });

    it('injects the custom shell source when the prop is provided', () => {
      const custom = `import App from './App'; export default () => <App/>;`;
      const out = withShellFile({ 'App.tsx': '...' }, 'App.tsx', custom);
      expect(out[SHELL_PATH]).toBe(custom);
    });

    it('user-provided ReplShell.tsx wins over both prop and default', () => {
      const userShell = `// I own this`;
      const propShell = `// from prop`;
      const out = withShellFile(
        { 'App.tsx': '...', [SHELL_PATH]: userShell },
        'App.tsx',
        propShell,
      );
      expect(out[SHELL_PATH]).toBe(userShell);
      // the function returns the same object reference when no injection happens
      // (callers compare identity to decide whether the shell flipped)
      expect(out[SHELL_PATH]).not.toContain('from prop');
    });

    it('does not mutate the input files map', () => {
      const input = { 'App.tsx': '...' };
      withShellFile(input, 'App.tsx', undefined);
      expect(SHELL_PATH in input).toBe(false);
    });

    it('honors a non-default entry', () => {
      const out = withShellFile({ 'Main.tsx': '...' }, 'Main.tsx', undefined);
      expect(out[SHELL_PATH]).toContain(`from './Main'`);
    });
  });
});
