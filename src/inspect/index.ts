/**
 * `mini-react-repl/inspect` — element-to-source attribution.
 *
 * Drop `<InspectMode/>` inside your `<ReplProvider/>` to install an in-iframe
 * element picker. On click, the callback fires with a typed payload
 * describing the picked DOM node and a source-mapped JSX call-site stack.
 *
 * @packageDocumentation
 * @public
 */

export { InspectMode, type InspectModeProps, default } from './InspectMode.tsx';
export type { ElementPick, StackFrame } from './types.ts';
