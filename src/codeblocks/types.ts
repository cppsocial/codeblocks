import type {
  CompilationResult,
  CompilerExplorerConfiguration,
  CompilerExplorerFile,
} from "../compiler-explorer/types";
import type { SourceRange } from "./source";

export type CodeBlockTheme = "auto" | "light" | "dark";
export type CodeBlockEditorMode = "full" | "simple";
export type CodeBlockAction = "run" | "compile" | "disassemble";
export type CodeBlockOutputView =
  "execution" | "compiler" | "assembly" | `tool:${string}`;
export type CodeBlockOutputPosition = "below" | "side" | "custom";
export type CodeBlockFit = boolean | "height" | "width" | "both";
export type CodeBlockEditableOption =
  "language" | "compiler" | "compiler_args" | "run_args" | "stdin" | "output";

export interface CodeBlockUiOptions {
  toolbar?: boolean;
  tabs?: boolean;
  runButton?: boolean;
  compilerExplorerLink?: boolean;
  info?: boolean;
  output?: boolean;
}

export interface CodeBlockInfo {
  name?: string;
  description?: string;
  sourceUrl?: string;
}

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
  language?: string;
  compiler?: string;
  compiler_args?: string;
  run_args?: string;
  /** @deprecated Use compiler_args. */
  compilerArgs?: string;
  /** @deprecated Use run_args. */
  runArgs?: string;
  stdin?: string;
  /** @deprecated Use compiler_args. */
  args?: string;
  readOnly?: boolean;
  inline?: boolean;
  /** Keep the simple highlighter and never initialize Monaco or clangd. */
  simple?: boolean;
  deferMonaco?: boolean;
  fit?: CodeBlockFit;
  src?: string;
  range?: SourceRange;
  highlightLines?: string | number[];
  files?: CompilerExplorerFile[];
  buildSystem?: "cmake";
  multiFile?: boolean;
  /** @deprecated Execution is inferred from whether the execution output view is requested. */
  action?: CodeBlockAction;
  outputViews?: CodeBlockOutputView[];
  outputPosition?: CodeBlockOutputPosition;
  /** Debounce in milliseconds; true uses 500ms. */
  live?: boolean | number;
  ui?: CodeBlockUiOptions;
  /** Fields exposed to the reader; true exposes all supported fields. */
  editableOptions?: boolean | CodeBlockEditableOption[];
  info?: CodeBlockInfo;
  compilerExplorer?: CompilerExplorerConfiguration;
  /** Replace the generated destination used by the Compiler Explorer action. */
  compilerExplorerLinkUrl?: string;
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
  setOutputView(view: CodeBlockOutputView): void;
  setEditorMode(mode: CodeBlockEditorMode): void;
  setTheme(theme: CodeBlockTheme): Promise<void>;
  dispose(): void;
  onDidChange(callback: (value: string) => void): () => void;
  editorReady: Promise<CodeBlocksEditor>;
  monacoReady: Promise<unknown>;
  clangdReady: Promise<void>;
  sourceReady: Promise<void>;
}
