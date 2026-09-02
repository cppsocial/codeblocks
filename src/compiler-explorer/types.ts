export interface CompilerExplorerFilters {
  binary: boolean;
  binaryObject: boolean;
  commentOnly: boolean;
  demangle: boolean;
  directives: boolean;
  execute: boolean;
  intel: boolean;
  labels: boolean;
  libraryCode: boolean;
  trim: boolean;
  debugCalls: boolean;
}

export interface CompilerExplorerConfiguration {
  baseUrl?: string;
  language?: string;
  compiler?: string;
  options?: string;
  filters?: Partial<CompilerExplorerFilters>;
  libs?: unknown[];
  specialoutputs?: string[];
  tools?: unknown[];
  overrides?: unknown[];
}

export interface CompilerInfo {
  id: string;
  name: string;
  lang: string;
  compilerType?: string;
  semver?: string;
  releaseTrack?: string;
}

export interface LanguageInfo {
  id: string;
  name: string;
}

export interface ToolInfo {
  id: string;
  name: string;
  type: string;
  languageId: string;
  allowStdin?: boolean;
}

export interface CompilerExplorerFile {
  filename: string;
  contents: string;
}

export interface CompilerExplorerTarget {
  baseUrl: string;
  language: string;
  compiler: string;
  options: string;
  run_args: string;
  stdin: string;
  filters: Partial<CompilerExplorerFilters>;
  libraries: unknown[];
  tools: unknown[];
  specialoutputs: string[];
  overrides: unknown[];
}

export interface CompilerOutputLine {
  text: string;
  tag?: { line: number; text: string };
}

export interface AssemblyLine {
  text: string;
  source?: { file: string | null; line: number } | null;
}

export interface CompilationResult {
  code?: number;
  didExecute: boolean;
  stdout?: CompilerOutputLine[];
  stderr?: CompilerOutputLine[];
  asm?: AssemblyLine[];
  buildResult?: {
    code?: number;
    stdout?: CompilerOutputLine[];
    stderr?: CompilerOutputLine[];
  };
  tools?: unknown[];
  okToCache?: boolean;
}

export interface CompileRequest extends Omit<
  CompilerExplorerTarget,
  | "run_args"
  | "stdin"
  | "filters"
  | "libraries"
  | "tools"
  | "specialoutputs"
  | "overrides"
> {
  source: string;
  files?: CompilerExplorerFile[];
  buildSystem?: "cmake";
  run_args?: string;
  stdin?: string;
  tools?: unknown[];
  filters?: Partial<CompilerExplorerFilters>;
  libraries?: unknown[];
  specialoutputs?: string[];
  overrides?: unknown[];
  /** Execute after compiling. Defaults to true for backward compatibility. */
  execute?: boolean;
}
