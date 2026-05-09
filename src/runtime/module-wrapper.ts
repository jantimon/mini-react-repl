/**
 * Wraps a transformed module's body with the Fast Refresh hook plumbing
 * and a `//# sourceURL` pragma so DevTools / stack traces attribute the
 * frame to the original path instead of the blob: URL.
 */
export function wrapModuleBody(path: string, body: string): string {
  const safe = JSON.stringify(path);
  // V8's sourceURL parser is `[^\s'"]*` and the comment is line-terminated
  // by \n, \r, U+2028, U+2029. Percent-encode anything in either set so a
  // path with whitespace or a stray line terminator can't truncate or
  // close the pragma. encodeURIComponent leaves `'` alone, so handle it
  // explicitly.
  const sourceURL = path.replace(/[\s'"]/g, (ch) =>
    ch === "'" ? '%27' : encodeURIComponent(ch),
  );
  return [
    `const __repl__ = window.__repl__;`,
    `const __prevReg = window.$RefreshReg$;`,
    `const __prevSig = window.$RefreshSig$;`,
    `window.$RefreshReg$ = (type, id) => __repl__.refresh.register(${safe}, type, id);`,
    `window.$RefreshSig$ = () => __repl__.refresh.createSignature();`,
    body,
    // restore previous reg/sig (best-effort; ESM modules execute once so
    // this is mostly defensive in case nested code reads them).
    `window.$RefreshReg$ = __prevReg;`,
    `window.$RefreshSig$ = __prevSig;`,
    `__repl__.commit(${safe});`,
    `//# sourceURL=${sourceURL}`,
  ].join('\n');
}
