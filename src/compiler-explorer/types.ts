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

export interface CompilerExplorerTarget {
  baseUrl: string;
  language: string;
  compiler: string;
  options: string;
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

export interface CompileRequest extends CompilerExplorerTarget {
  source: string;
}
