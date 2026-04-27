/**
 * File tabs for the headless layout. Renders one tab per file plus a "+"
 * button to add a new file. Active file is selected via context.
 *
 * Styling: emits stable class names + `data-active` / `data-language`
 * attributes. Bring your own CSS or use `mini-react-repl/theme.css`.
 *
 * @public
 */

import { useContext, useMemo } from 'react';
import { ReplActionsContext, ReplStateContext } from './context.ts';
import { languageFor } from '../engine/path-utils.ts';

export type ReplFileTabsProps = {
  /** Optional className applied to the outer `<div>`. */
  className?: string;
  /** Optional inline styles applied to the outer `<div>`. */
  style?: React.CSSProperties;
  /**
   * Called when the user clicks the "+" button. If omitted, a built-in
   * `prompt()` flow is used. Override to provide a custom dialog.
   */
  onAddFile?: () => void;
  /**
   * Called when the user requests deletion. If omitted, deletion is allowed
   * with no confirmation. Return `false` to cancel.
   */
  onDeleteFile?: (path: string) => boolean | void;
};

export function ReplFileTabs(props: ReplFileTabsProps): React.ReactElement {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) throw new Error('<ReplFileTabs/> must be inside <ReplProvider/>');

  const paths = useMemo(() => Object.keys(state.files).sort(), [state.files]);

  const handleAdd = () => {
    if (props.onAddFile) {
      props.onAddFile();
      return;
    }
    const name = window.prompt('New file name (e.g. Counter.tsx):')?.trim();
    if (!name) return;
    if (!/\.(tsx?|jsx?|css)$/.test(name)) {
      window.alert('File name must end in .tsx, .ts, .jsx, .js, or .css');
      return;
    }
    if (name in state.files) {
      window.alert(`'${name}' already exists`);
      return;
    }
    actions.setFile(name, '');
    actions.setActivePath(name);
  };

  const handleDelete = (path: string) => {
    if (path === actions.entry) {
      window.alert(`Cannot delete the entry file '${actions.entry}'`);
      return;
    }
    if (props.onDeleteFile) {
      const ok = props.onDeleteFile(path);
      if (ok === false) return;
    }
    actions.removeFile(path);
    if (state.activePath === path) actions.setActivePath(actions.entry);
  };

  return (
    <div className={`repl-tabs ${props.className ?? ''}`} style={props.style} role="tablist">
      {paths.map((path) => {
        const isActive = path === state.activePath;
        return (
          <button
            key={path}
            type="button"
            role="tab"
            className="repl-tab"
            data-active={isActive}
            data-language={languageFor(path)}
            aria-selected={isActive}
            onClick={() => actions.setActivePath(path)}
            onAuxClick={(e) => {
              if (e.button === 1) handleDelete(path);
            }}
          >
            <span className="repl-tab-label">{path}</span>
            {path !== actions.entry && (
              <span
                className="repl-tab-close"
                role="button"
                aria-label={`Delete ${path}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(path);
                }}
              >
                ×
              </span>
            )}
          </button>
        );
      })}
      <button type="button" className="repl-tab-add" onClick={handleAdd} aria-label="Add file">
        +
      </button>
    </div>
  );
}
