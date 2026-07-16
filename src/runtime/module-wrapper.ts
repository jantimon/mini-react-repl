/**
 * Wraps a transformed module's body with the Fast Refresh hook plumbing
 * and a `//# sourceURL` pragma so DevTools / stack traces attribute the
 * frame to the original path instead of the blob: URL.
 *
 * With `hmr: false` the Refresh plumbing is omitted: swc emitted no
 * `$RefreshReg$` / `$RefreshSig$` calls to serve, so the only wrapping left
 * is the `commit` epilogue and the pragma. Nothing is prepended, so the
 * body's inline source map passes through byte-exact.
 */
export function wrapModuleBody(path: string, body: string, hmr = true): string {
  const safe = JSON.stringify(path);
  // V8's sourceURL parser is `[^\s'"]*` and the comment is line-terminated
  // by \n, \r, U+2028, U+2029. Percent-encode anything in either set so a
  // path with whitespace or a stray line terminator can't truncate or
  // close the pragma. encodeURIComponent leaves `'` alone, so handle it
  // explicitly.
  const sourceURL = path.replace(/[\s'"]/g, (ch) => (ch === "'" ? '%27' : encodeURIComponent(ch)));
  if (!hmr) {
    // `__repl__` is a prologue-local alias, so reach through `window` here.
    return [body, `window.__repl__.commit(${safe});`, `//# sourceURL=${sourceURL}`].join('\n');
  }
  // Joined onto one line so the body shifts by exactly one generated line.
  const prologue = [
    `const __repl__ = window.__repl__;`,
    `const __prevReg = window.$RefreshReg$;`,
    `const __prevSig = window.$RefreshSig$;`,
    `window.$RefreshReg$ = (type, id) => __repl__.refresh.register(${safe}, type, id);`,
    `window.$RefreshSig$ = () => __repl__.refresh.createSignature();`,
  ].join('');
  const shiftedBody = shiftInlineSourceMap(body, 1);
  return [
    prologue,
    shiftedBody,
    // restore previous reg/sig (best-effort; ESM modules execute once so
    // this is mostly defensive in case nested code reads them).
    `window.$RefreshReg$ = __prevReg;`,
    `window.$RefreshSig$ = __prevSig;`,
    `__repl__.commit(${safe});`,
    `//# sourceURL=${sourceURL}`,
  ].join('\n');
}

/**
 * Shift an inline base64 source map's `mappings` down by `prependLines`
 * generated lines. Uses the source-map v3 invariant that `;` separates
 * generated lines and an empty inter-`;` slot is "no mappings on this
 * line", so a pure semicolon prepend is a pure vertical shift — no VLQ
 * decode required.
 *
 * Round-trips through `TextEncoder` / `TextDecoder` because `atob` / `btoa`
 * are Latin-1 only; SWC base64-encodes UTF-8 bytes, so non-ASCII characters
 * in `sourcesContent` (comments, strings, identifiers) would otherwise
 * corrupt or throw on re-encode.
 */
export function shiftInlineSourceMap(body: string, prependLines: number): string {
  if (prependLines <= 0) return body;
  return body.replace(
    /\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)/,
    (match, b64: string) => {
      try {
        const json = utf8FromBase64(b64);
        // String-level patch instead of JSON.parse so we don't perturb key
        // order, numeric formatting, or escape style. The first occurrence
        // of `"mappings":"` is the one we want; nested matches inside
        // sourcesContent would have to survive JSON escaping (`\"`) and
        // can't appear unescaped.
        const shifted = json.replace(/"mappings":"/, `"mappings":"${';'.repeat(prependLines)}`);
        // If the field wasn't found, leave the comment byte-exact rather
        // than re-encoding garbage we didn't understand.
        if (shifted === json) return match;
        return '//# sourceMappingURL=data:application/json;base64,' + base64FromUtf8(shifted);
      } catch {
        // Malformed map → leave the comment untouched. Better than throwing
        // and breaking module evaluation over a debug aid.
        return match;
      }
    },
  );
}

function utf8FromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64FromUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
