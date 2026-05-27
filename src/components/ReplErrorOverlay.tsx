/**
 * Standalone error overlay for headless layouts that render the built-in
 * overlay outside the iframe (e.g. in a sidebar). Reads the most recent
 * error from {@link ReplProvider} context.
 *
 * For most consumers, the in-iframe overlay rendered by `<ReplPreview/>`
 * is enough — this exists for advanced layouts.
 *
 * @public
 */

import { useContext } from 'react';
import { ReplErrorContext } from './context.ts';
import type { ReplError } from '../types.ts';

export type ReplErrorOverlayProps = {
  className?: string;
  style?: React.CSSProperties;
  /** Render-prop override for the entire overlay body. */
  render?: (err: ReplError) => React.ReactNode;
};

export function ReplErrorOverlay(props: ReplErrorOverlayProps): React.ReactElement | null {
  const ctx = useContext(ReplErrorContext);
  if (!ctx) throw new Error('<ReplErrorOverlay/> must be inside <ReplProvider/>');
  const err = ctx.lastError;
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
      {renderErrorBody(err)}
    </div>
  );
}

function renderErrorBody(err: ReplError): React.ReactNode {
  switch (err.kind) {
    case 'transform':
      return (
        <>
          <div className="repl-error-overlay__title">Transform error</div>
          <div className="repl-error-overlay__path">{err.path}</div>
          <div className="repl-error-overlay__message">{err.message}</div>
          {err.loc && (
            <div className="repl-error-overlay__loc">
              line {err.loc.line}, column {err.loc.column}
            </div>
          )}
        </>
      );
    case 'resolve':
      return (
        <>
          <div className="repl-error-overlay__title">Module not found</div>
          <div className="repl-error-overlay__path">{err.path}</div>
          <div className="repl-error-overlay__message">{`Cannot resolve '${err.specifier}'`}</div>
        </>
      );
    case 'runtime':
      return (
        <>
          <div className="repl-error-overlay__title">Runtime error</div>
          <div className="repl-error-overlay__message">{err.message}</div>
          {err.stack && <pre className="repl-error-overlay__stack">{err.stack}</pre>}
        </>
      );
    default:
      return ((kind: never) => kind)(err);
  }
}
