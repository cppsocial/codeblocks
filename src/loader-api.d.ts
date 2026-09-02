export type CodeBlocksStatus =
  | { type: "monaco-loading" }
  | { type: "monaco-ready" }
  | { type: "clangd-downloading"; loaded: number; total?: number }
  | { type: "clangd-starting" }
  | { type: "clangd-loaded" }
  | { type: "clangd-ready" }
  | { type: "clangd-error"; error: Error };

export interface CodeBlockInstance {
  getValue(): string;
  setValue(value: string): void;
  compile(): Promise<unknown>;
  run(): Promise<void>;
  setOutputView(
    view: "execution" | "compiler" | "assembly" | `tool:${string}`,
  ): void;
  setEditorMode(mode: "full" | "simple"): void;
  setTheme(theme: "light" | "dark"): Promise<void>;
  sourceReady: Promise<void>;
}

export interface CodeBlocksApi {
  configure(options: {
    theme?: "auto" | "light" | "dark";
    language?: string;
    compiler?: string;
    compiler_args?: string;
    run_args?: string;
    stdin?: string;
    readOnly?: boolean;
    inline?: boolean;
    simple?: boolean;
    fit?: boolean | "height" | "width" | "both";
    src?: string;
    range?: {
      startLine?: number;
      endLine?: number;
      startColumn?: number;
      endColumn?: number;
    };
    highlightLines?: string | number[];
    files?: Array<{ filename: string; contents: string }>;
    compilerExplorerLinkUrl?: string;
    buildSystem?: "cmake";
    multiFile?: boolean;
    action?: "run" | "compile" | "disassemble";
    outputViews?: Array<
      "execution" | "compiler" | "assembly" | `tool:${string}`
    >;
    outputPosition?: "below" | "side" | "custom";
    live?: boolean | number;
    editableOptions?: boolean | string[];
    ui?: {
      toolbar?: boolean;
      tabs?: boolean;
      runButton?: boolean;
      compilerExplorerLink?: boolean;
      info?: boolean;
      output?: boolean;
    };
    editorOptions?: Record<string, unknown>;
    onStatus?: (status: CodeBlocksStatus) => void;
  }): void;
  get(element: Element): CodeBlockInstance | undefined;
  setEditorMode(mode: "full" | "simple", root?: ParentNode): void;
  setTheme(theme: "auto" | "light" | "dark", root?: ParentNode): Promise<void>;
  ready: Promise<CodeBlocksApi>;
}

declare global {
  var CodeBlocks: CodeBlocksApi;

  interface Window {
    CodeBlocks?: CodeBlocksApi;
  }
}
