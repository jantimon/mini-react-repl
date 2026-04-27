/**
 * In-iframe error overlay. A single fixed-position element that surfaces
 * transform, runtime, and resolve errors. Toggleable via parent props.
 *
 * @internal
 */

const OVERLAY_ID = '__repl-error-overlay__';

const STYLE = `
:host { all: initial; }
.repl-error-overlay {
  position: fixed; inset: 0;
  background: rgba(20, 20, 24, 0.92);
  color: #ffd5d5;
  font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 24px 28px;
  z-index: 2147483647;
  overflow: auto;
}
.repl-error-overlay__head {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 100, 100, 0.3);
  margin-bottom: 16px;
}
.repl-error-overlay__title {
  color: #ff8a8a;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.repl-error-overlay__close {
  background: transparent;
  color: #ffd5d5;
  border: 1px solid rgba(255, 213, 213, 0.4);
  padding: 4px 10px;
  font: inherit;
  cursor: pointer;
  border-radius: 4px;
}
.repl-error-overlay__close:hover {
  background: rgba(255, 213, 213, 0.1);
}
.repl-error-overlay__path {
  color: #aab;
  font-size: 12px;
  margin-bottom: 4px;
}
.repl-error-overlay__message {
  color: #fff;
  white-space: pre-wrap;
  font-size: 14px;
}
.repl-error-overlay__loc {
  color: #ffb37a;
  font-size: 12px;
  margin-top: 6px;
}
.repl-error-overlay__stack {
  margin-top: 12px;
  color: #99a;
  font-size: 12px;
  white-space: pre-wrap;
}
`;

export type OverlayError =
  | { kind: 'transform'; path: string; message: string; loc?: { line: number; column: number } }
  | { kind: 'resolve'; path: string; specifier: string }
  | { kind: 'runtime'; message: string; stack: string };

let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let enabled = true;

function ensureHost(): { host: HTMLElement; shadow: ShadowRoot } {
  if (hostEl && shadowRoot) return { host: hostEl, shadow: shadowRoot };
  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.style.all = 'initial';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.appendChild(style);
  document.body.appendChild(host);
  hostEl = host;
  shadowRoot = shadow;
  return { host, shadow };
}

export function setOverlayEnabled(value: boolean): void {
  enabled = value;
  if (!value) hideOverlay();
}

export function showOverlay(err: OverlayError): void {
  if (!enabled) return;
  const { shadow } = ensureHost();

  const existing = shadow.querySelector('.repl-error-overlay');
  if (existing) existing.remove();

  const root = document.createElement('div');
  root.className = 'repl-error-overlay';

  const head = document.createElement('div');
  head.className = 'repl-error-overlay__head';

  const title = document.createElement('span');
  title.className = 'repl-error-overlay__title';
  title.textContent = labelFor(err);
  head.appendChild(title);

  const close = document.createElement('button');
  close.className = 'repl-error-overlay__close';
  close.textContent = 'Dismiss';
  close.onclick = () => hideOverlay();
  head.appendChild(close);

  root.appendChild(head);

  if (err.kind === 'transform') {
    const path = document.createElement('div');
    path.className = 'repl-error-overlay__path';
    path.textContent = err.path;
    root.appendChild(path);
    const msg = document.createElement('div');
    msg.className = 'repl-error-overlay__message';
    msg.textContent = err.message;
    root.appendChild(msg);
    if (err.loc) {
      const loc = document.createElement('div');
      loc.className = 'repl-error-overlay__loc';
      loc.textContent = `at line ${err.loc.line}, column ${err.loc.column}`;
      root.appendChild(loc);
    }
  } else if (err.kind === 'resolve') {
    const path = document.createElement('div');
    path.className = 'repl-error-overlay__path';
    path.textContent = err.path;
    root.appendChild(path);
    const msg = document.createElement('div');
    msg.className = 'repl-error-overlay__message';
    msg.textContent = `Module not found: '${err.specifier}'`;
    root.appendChild(msg);
  } else {
    const msg = document.createElement('div');
    msg.className = 'repl-error-overlay__message';
    msg.textContent = err.message;
    root.appendChild(msg);
    if (err.stack) {
      const stack = document.createElement('div');
      stack.className = 'repl-error-overlay__stack';
      stack.textContent = err.stack;
      root.appendChild(stack);
    }
  }

  shadow.appendChild(root);
}

export function hideOverlay(): void {
  if (!shadowRoot) return;
  const existing = shadowRoot.querySelector('.repl-error-overlay');
  if (existing) existing.remove();
}

function labelFor(err: OverlayError): string {
  switch (err.kind) {
    case 'transform':
      return 'Transform error';
    case 'resolve':
      return 'Module not found';
    case 'runtime':
      return 'Runtime error';
  }
}
