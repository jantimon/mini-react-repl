/**
 * Wraps a transformed module body with the prologue/epilogue the iframe
 * runtime expects:
 *
 *   - prologue: `$RefreshReg$` / `$RefreshSig$` are bound to per-module helpers
 *   - epilogue: `__repl__.commit(path)` signals "module body finished" so
 *     the runtime can schedule a Refresh.
 *
 * @internal
 */

/**
 * Wrap a transformed module's JS body for execution in the iframe.
 *
 * The runtime side is established as `window.__repl__`. We bind the Refresh
 * helpers locally so swc's `refresh: true` output (which calls
 * `$RefreshReg$(type, id)` and `$RefreshSig$()` in module scope) finds them.
 *
 * @param path  logical path (becomes part of the Refresh ID prefix)
 * @param code  transformed JS body (already import-rewritten)
 */
export function wrapModule(path: string, code: string): string {
  const safePath = JSON.stringify(path);
  return [
    `const __repl__ = window.__repl__;`,
    `const __prevRefreshReg = window.$RefreshReg$;`,
    `const __prevRefreshSig = window.$RefreshSig$;`,
    `window.$RefreshReg$ = (type, id) => __repl__.refresh.register(${safePath}, type, id);`,
    `window.$RefreshSig$ = () => __repl__.refresh.createSignature();`,
    `try {`,
    code,
    `} finally {`,
    `  window.$RefreshReg$ = __prevRefreshReg;`,
    `  window.$RefreshSig$ = __prevRefreshSig;`,
    `}`,
    `__repl__.commit(${safePath});`,
  ].join('\n');
}

/**
 * Wrap a CSS file as a no-op JS module (so `import './x.css'` doesn't break).
 * The actual style injection is handled by `css-upsert` postMessage out of
 * band; this wrapper just satisfies the import.
 */
export function wrapCssAsJs(path: string): string {
  return `// css module shim for ${path}\nexport default null;\n`;
}
