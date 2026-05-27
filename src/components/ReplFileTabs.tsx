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
   * Override the protected entry path. Defaults to the surrounding
   * `<ReplProvider/>`'s `entry`. The tab for this path can't be deleted —
   * deleting the entry would leave the runtime without a default export
   * to mount.
   */
  entry?: string;
  /**
   * Called when the user clicks the "+" button. Return the new file name
   * (sync or async). Return `null`/`undefined`/`''` to cancel. If omitted,
   * a built-in `prompt()` flow is used.
   */
  onAddFile?: () => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Called when the user requests deletion (sync or async). Return `false`
   * to cancel. If omitted, deletion proceeds with no confirmation.
   */
  onDeleteFile?: (path: string) => boolean | void | Promise<boolean | void>;
};

export function ReplFileTabs(props: ReplFileTabsProps): React.ReactElement {
  const state = useContext(ReplStateContext);
  const actions = useContext(ReplActionsContext);
  if (!state || !actions) throw new Error('<ReplFileTabs/> must be inside <ReplProvider/>');

  const entry = props.entry ?? actions.entry;
  const paths = useMemo(() => Object.keys(state.files).sort(), [state.files]);

  const handleAdd = async () => {
    const raw = props.onAddFile
      ? await props.onAddFile()
      : window.prompt('New file name (e.g. Counter.tsx):');
    const name = raw?.trim();
    if (!name) return;
    if (name in state.files) {
      window.alert(`'${name}' already exists`);
      return;
    }
    actions.setFile(name, '');
    actions.setActivePath(name);
  };

  const handleDelete = async (path: string) => {
    if (path === entry) {
      window.alert(`Cannot delete the entry file '${entry}'`);
      return;
    }
    if (props.onDeleteFile) {
      const ok = await props.onDeleteFile(path);
      if (ok === false) return;
    }
    actions.removeFile(path);
    if (state.activePath === path) actions.setActivePath(entry);
  };

  return (
    <div className={`repl-tabs ${props.className ?? ''}`} style={props.style} role="tablist">
      {paths.map((path) => {
        const isActive = path === state.activePath;
        const isEntry = path === entry;
        return (
          // Wrapper is `role="presentation"` so the `<button role="tab">`
          // remains the logical child of the tablist for AT, while the close
          // `<button>` can sit alongside without producing button-in-button
          // invalid HTML.
          <span key={path} role="presentation" className="repl-tab-wrapper">
            <button
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
            </button>
            {!isEntry && (
              <button
                type="button"
                className="repl-tab-close"
                aria-label={`Delete ${path}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(path);
                }}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      <button type="button" className="repl-tab-add" onClick={handleAdd} aria-label="Add file">
        +
      </button>
    </div>
  );
}
