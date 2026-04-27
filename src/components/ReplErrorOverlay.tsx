/**
 * Standalone error overlay for headless layouts that want to render the
 * built-in overlay outside the iframe (e.g. a sidebar). Reads the most
 * recent error from {@link ReplProvider} context.
 *
 * For most consumers, the in-iframe overlay rendered by `<ReplPreview/>`
 * is enough — this exists for advanced layouts.
 *
 * @public
 */

import { useContext } from 'react';
import { ReplStateContext } from './context.ts';

export type ReplErrorOverlayProps = {
  className?: string;
  style?: React.CSSProperties;
  /** Render-prop override for the entire overlay body. */
  render?: (
    err:
      | { kind: 'transform'; path: string; message: string; loc?: { line: number; column: number } }
      | { kind: 'runtime'; message: string; stack: string }
      | { kind: 'resolve'; path: string; specifier: string },
  ) => React.ReactNode;
};

export function ReplErrorOverlay(props: ReplErrorOverlayProps): React.ReactElement | null {
  const state = useContext(ReplStateContext);
  if (!state) throw new Error('<ReplErrorOverlay/> must be inside <ReplProvider/>');
  const err = state.lastError;
  if (!err) return null;

  if (props.render) {
    return (
      <div className={`repl-error-overlay ${props.className ?? ''}`} style={props.style}>
        {props.render(err)}
      </div>
    );
  }

  return (
    <div
      className={`repl-error-overlay ${props.className ?? ''}`}
      style={props.style}
      role="alert"
      data-kind={err.kind}
    >
      <div className="repl-error-overlay__title">
        {err.kind === 'transform'
          ? 'Transform error'
          : err.kind === 'resolve'
            ? 'Module not found'
            : 'Runtime error'}
      </div>
      {(err.kind === 'transform' || err.kind === 'resolve') && (
        <div className="repl-error-overlay__path">{err.path}</div>
      )}
      <div className="repl-error-overlay__message">
        {err.kind === 'resolve' ? `Cannot resolve '${err.specifier}'` : err.message}
      </div>
      {err.kind === 'transform' && err.loc && (
        <div className="repl-error-overlay__loc">
          line {err.loc.line}, column {err.loc.column}
        </div>
      )}
      {err.kind === 'runtime' && err.stack && (
        <pre className="repl-error-overlay__stack">{err.stack}</pre>
      )}
    </div>
  );
}
