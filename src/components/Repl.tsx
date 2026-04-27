/**
 * Drop-in editor + preview. Default layout (tabs / editor / preview)
 * suitable for embeds and docs.
 *
 * For custom layouts, drop down to the headless parts:
 * {@link ReplProvider}, {@link ReplFileTabs}, {@link ReplPreview}.
 *
 * @example
 * ```tsx
 * import { Repl } from 'mini-react-repl'
 * import { defaultVendor } from 'mini-react-repl/vendor-default'
 * import { MonacoReplEditor } from 'mini-react-repl/editor-monaco'
 *
 * <Repl
 *   files={files}
 *   onFilesChange={setFiles}
 *   vendor={defaultVendor}
 *   editor={MonacoReplEditor}
 * />
 * ```
 *
 * @public
 */

import { ReplProvider, type ReplProviderProps } from './ReplProvider.tsx';
import { ReplFileTabs, type ReplFileTabsProps } from './ReplFileTabs.tsx';
import { ReplPreview, type ReplPreviewProps } from './ReplPreview.tsx';
import { EditorHost } from './EditorHost.tsx';
import type { ReplEditorComponent } from '../types.ts';

export type ReplProps = ReplProviderProps &
  ReplPreviewProps &
  Pick<ReplFileTabsProps, 'onAddFile' | 'onDeleteFile'> & {
    /**
     * Editor adapter component (e.g. `MonacoReplEditor` from
     * `mini-react-repl/editor-monaco`). Required.
     */
    editor: ReplEditorComponent;
    /** Override the default layout's outer wrapper className. */
    className?: string;
    /** Override the default layout's outer wrapper style. */
    style?: React.CSSProperties;
  };

export function Repl(props: ReplProps): React.ReactElement {
  const {
    editor,
    headHtml,
    bodyHtml,
    showPreviewErrorOverlay,
    onPreviewError,
    onMounted,
    iframeRef,
    onAddFile,
    onDeleteFile,
    className,
    style,
    ...providerProps
  } = props;

  return (
    <ReplProvider {...providerProps}>
      <div className={`repl-root ${className ?? ''}`} style={style}>
        <div className="repl-root__main">
          <ReplFileTabs
            {...(onAddFile ? { onAddFile } : {})}
            {...(onDeleteFile ? { onDeleteFile } : {})}
          />
          <EditorHost editor={editor} />
        </div>
        <div className="repl-root__side">
          <ReplPreview
            {...(headHtml !== undefined ? { headHtml } : {})}
            {...(bodyHtml !== undefined ? { bodyHtml } : {})}
            {...(showPreviewErrorOverlay !== undefined ? { showPreviewErrorOverlay } : {})}
            {...(onPreviewError ? { onPreviewError } : {})}
            {...(onMounted ? { onMounted } : {})}
            {...(iframeRef ? { iframeRef } : {})}
          />
        </div>
      </div>
    </ReplProvider>
  );
}
