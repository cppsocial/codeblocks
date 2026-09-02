/// <reference types="vite/client" />

declare const __WASM_SIZE__: number;

declare module "*.css?inline" {
  const contents: string;
  export default contents;
}

declare module "*.worker?worker&url" {
  const url: string;
  export default url;
}
