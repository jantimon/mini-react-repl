/// <reference types="vite/client" />

declare const __REPL_VERSION__: string;

declare module '*.wasm?url' {
  const url: string;
  export default url;
}
