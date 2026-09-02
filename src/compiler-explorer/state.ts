import type {
  CompilerExplorerConfiguration,
  CompilerExplorerFilters,
  CompilerExplorerTarget,
} from "./types";

export const DEFAULT_COMPILER = "clang2110";
export const DEFAULT_OPTIONS = "-std=c++2c -Wall -Wextra -pedantic-errors";

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
  compiler?: string;
  args?: string;
  compilerExplorer?: CompilerExplorerConfiguration;
  compilerExplorerUrl?: string;
}

/** Resolve one target shared by API compilation and generated links. */
export function resolveCompilerExplorerTarget(
  selection: CompilerSelection,
): CompilerExplorerTarget {
  const explorer = selection.compilerExplorer;
  return {
    baseUrl:
      explorer?.baseUrl ??
      selection.compilerExplorerUrl ??
      "https://godbolt.org/",
    language: explorer?.language ?? "c++",
    // Top-level values describe the code box's run line and take precedence.
    compiler: selection.compiler ?? explorer?.compiler ?? DEFAULT_COMPILER,
    options: selection.args ?? explorer?.options ?? DEFAULT_OPTIONS,
  };
}

export function createCompilerExplorerUrl(
  source: string,
  filename: string,
  selection: CompilerSelection,
): string {
  const explorer = selection.compilerExplorer ?? {};
  const target = resolveCompilerExplorerTarget(selection);
  const compilerState = {
    id: target.compiler,
    options: target.options,
    filters: { ...DEFAULT_FILTERS, ...explorer.filters, execute: true },
    libs: explorer.libs ?? [],
    specialoutputs: explorer.specialoutputs ?? [],
    tools: explorer.tools ?? [],
    overrides: explorer.overrides ?? [],
  };
  const state = {
    sessions: [
      {
        id: 1,
        language: target.language,
        source,
        filename,
        compilers: [compilerState],
        // An executor makes the program output an explicit view in addition to
        // the assembly compiler whose execute filter is enabled above.
        executors: [
          {
            arguments: "",
            compiler: {
              id: target.compiler,
              libs: explorer.libs ?? [],
              options: target.options,
            },
            stdin: "",
          },
        ],
      },
    ],
    trees: [],
  };
  const baseUrl = new URL(target.baseUrl);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  return new URL(`clientstate/${base64Url(JSON.stringify(state))}`, baseUrl).href;
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
