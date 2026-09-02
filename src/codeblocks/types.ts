import type {
  CompilationResult,
  CompilerExplorerConfiguration,
} from "../compiler-explorer/types";

export type CodeBlockTheme = "auto" | "light" | "dark";

export type CodeBlocksStatus =
  | { type: "monaco-loading" }
  | { type: "monaco-ready" }
  | { type: "clangd-downloading"; loaded: number; total?: number }
  | { type: "clangd-starting" }
  | { type: "clangd-loaded" }
  | { type: "clangd-ready" }
  | { type: "clangd-error"; error: Error };

export interface CodeBlocksEditor {
  focus(): void;
  getValue(): string;
  setValue(value: string): void;
}

export interface CodeBlocksConfiguration {
  theme?: CodeBlockTheme;
  showDebugControls?: boolean;
  compiler?: string;
  args?: string;
  compilerExplorer?: CompilerExplorerConfiguration;
  /** @deprecated Use compilerExplorer.baseUrl. */
  compilerExplorerUrl?: string;
  editorOptions?: Record<string, unknown>;
  styles?: Record<string, string>;
  /** Set false to consume compile() results without the built-in drawer. */
  renderOutput?: boolean;
  onResult?: (result: CompilationResult) => void;
  onStatus?: (status: CodeBlocksStatus) => void;
}

export interface CreateCodeBlockOptions extends CodeBlocksConfiguration {
  element: HTMLElement;
  value?: string;
}

export interface CodeBlock {
  getValue(): string;
  setValue(value: string): void;
  getTabs(): Array<{ name: string; value: string }>;
  selectTab(tab: string | number): void;
  getCompilerExplorerUrl(): string;
  focus(): void;
  compile(): Promise<CompilationResult>;
  run(): Promise<void>;
  setTheme(theme: CodeBlockTheme): Promise<void>;
  dispose(): void;
  onDidChange(callback: (value: string) => void): () => void;
  editorReady: Promise<CodeBlocksEditor>;
  monacoReady: Promise<unknown>;
  clangdReady: Promise<void>;
}
