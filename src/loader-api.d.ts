export type CodeBlocksStatus =
  | { type: "monaco-loading" }
  | { type: "monaco-ready" }
  | { type: "clangd-downloading"; loaded: number; total?: number }
  | { type: "clangd-starting" }
  | { type: "clangd-loaded" }
  | { type: "clangd-ready" }
  | { type: "clangd-error"; error: Error };

export interface CodeBlockInstance {
  setTheme(theme: "light" | "dark"): Promise<void>;
}

export interface CodeBlocksApi {
  configure(options: {
    theme?: "auto" | "light" | "dark";
    editorOptions?: Record<string, unknown>;
    onStatus?: (status: CodeBlocksStatus) => void;
  }): void;
  get(element: Element): CodeBlockInstance | undefined;
  ready: Promise<CodeBlocksApi>;
}

declare global {
  var CodeBlocks: CodeBlocksApi;

  interface Window {
    CodeBlocks?: CodeBlocksApi;
  }
}
