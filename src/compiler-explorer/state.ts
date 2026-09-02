import type {
  CompilerExplorerConfiguration,
  CompilerExplorerFile,
  CompilerExplorerFilters,
  CompilerExplorerTarget,
} from "./types";

export const DEFAULT_COMPILER = "clang2110";
export const DEFAULT_OPTIONS = "-std=c++2c -Wall -Wextra -pedantic-errors";
export const LANGUAGE_DEFAULTS: Readonly<
  Record<string, { compiler: string; options: string }>
> = {
  "c++": { compiler: DEFAULT_COMPILER, options: DEFAULT_OPTIONS },
  c: {
    compiler: "cclang2110",
    options: "-std=c23 -Wall -Wextra -pedantic-errors",
  },
};

const DEFAULT_FILTERS: CompilerExplorerFilters = {
  binary: false,
  binaryObject: false,
  commentOnly: true,
  demangle: true,
  directives: true,
  execute: true,
  intel: true,
  labels: true,
  libraryCode: false,
  trim: false,
  debugCalls: false,
};

export interface CompilerSelection {
  language?: string;
  compiler?: string;
  compiler_args?: string;
  run_args?: string;
  /** @deprecated Use compiler_args. */
  compilerArgs?: string;
  /** @deprecated Use run_args. */
  runArgs?: string;
  stdin?: string;
  execute?: boolean;
  /** @deprecated Use compiler_args. */
  args?: string;
  compilerExplorer?: CompilerExplorerConfiguration;
  compilerExplorerUrl?: string;
  files?: CompilerExplorerFile[];
  buildSystem?: "cmake";
}

export function resolveCompilerExplorerTarget(
  selection: CompilerSelection,
): CompilerExplorerTarget {
  const explorer = selection.compilerExplorer;
  const language = selection.language ?? explorer?.language ?? "c++";
  const defaults = LANGUAGE_DEFAULTS[language.toLowerCase()];
  return {
    baseUrl:
      explorer?.baseUrl ??
      selection.compilerExplorerUrl ??
      "https://godbolt.org/",
    language,
    compiler:
      selection.compiler ?? explorer?.compiler ?? defaults?.compiler ?? "",
    options:
      selection.compiler_args ??
      selection.compilerArgs ??
      selection.args ??
      explorer?.options ??
      defaults?.options ??
      "",
    run_args: selection.run_args ?? selection.runArgs ?? "",
    stdin: selection.stdin ?? "",
    filters: { libraryCode: false, ...explorer?.filters },
    libraries: explorer?.libs ?? [],
    tools: explorer?.tools ?? [],
    specialoutputs: explorer?.specialoutputs ?? [],
    overrides: explorer?.overrides ?? [],
  };
}

export function createCompilerExplorerUrl(
  source: string,
  filename: string,
  selection: CompilerSelection,
): string {
  const explorer = selection.compilerExplorer ?? {};
  const target = resolveCompilerExplorerTarget(selection);
  if (!target.compiler) {
    throw new Error(
      `A compiler must be configured for language “${target.language}”`,
    );
  }
  const execute = selection.execute ?? explorer.filters?.execute ?? true;
  const compilerState = {
    id: target.compiler,
    options: target.options,
    filters: {
      ...DEFAULT_FILTERS,
      ...target.filters,
      execute,
    },
    libs: target.libraries,
    specialoutputs: target.specialoutputs,
    tools: target.tools,
    overrides: target.overrides,
  };
  const executorState = {
    arguments: target.run_args,
    compiler: {
      id: target.compiler,
      libs: target.libraries,
      options: target.options,
      overrides: target.overrides,
    },
    stdin: target.stdin,
  };
  const session = {
    id: 1,
    language: target.language,
    source,
    filename,
    compilers: [compilerState],
    executors: [],
  };
  const files = selection.files ?? [];
  const state =
    files.length || selection.buildSystem
      ? (() => {
          const primaryFilename = selection.buildSystem
            ? filename
            : filename.toLowerCase().endsWith(".cpp")
              ? "example.cpp"
              : filename;
          const projectFiles = [
            { filename: primaryFilename, contents: source },
            ...files,
          ];
          return {
            sessions: projectFiles.map((file, index) => ({
              id: index + 1,
              language: target.language,
              source: file.contents,
              filename: file.filename,
              compilers: [],
              executors: [],
            })),
            trees: [
              {
                id: 1,
                buildSystem: selection.buildSystem ?? "none",
                isCMakeProject: selection.buildSystem === "cmake",
                compilerLanguageId: target.language,
                files: projectFiles.map((file, index) => ({
                  id: index + 1,
                  fileId: index + 1,
                  isIncluded: true,
                  isOpen: true,
                  isMainSource: index === 0,
                  filename: file.filename,
                  content: file.contents,
                  editorId: index + 1,
                  langId: target.language,
                })),
                newFileId: files.length + 2,
                compilers: execute ? [] : [compilerState],
                executors: execute ? [executorState] : [],
              },
            ],
          };
        })()
      : {
          sessions: [session],
          trees: [],
        };
  const baseUrl = new URL(target.baseUrl);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  return new URL(`clientstate/${base64Url(JSON.stringify(state))}`, baseUrl)
    .href;
}

function base64Url(value: string): string {
  const escaped = value.replace(
    /[\u007F-\uFFFF]/g,
    (character) =>
      `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`,
  );
  const bytes = new TextEncoder().encode(escaped);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
