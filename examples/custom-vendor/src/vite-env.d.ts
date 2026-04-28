/// <reference types="vite/client" />

declare module '*.tsx?raw' {
  const src: string;
  export default src;
}
