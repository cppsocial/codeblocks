import type {
  CompilationResult,
  CompileRequest,
  CompilerInfo,
  LanguageInfo,
  ToolInfo,
} from "./types";

export async function listCompilerExplorerLanguages(
  baseUrl = "https://godbolt.org/",
): Promise<LanguageInfo[]> {
  return getExplorerJson(baseUrl, "api/languages");
}

export async function listCompilerExplorerTools(
  language: string,
  baseUrl = "https://godbolt.org/",
): Promise<ToolInfo[]> {
  return getExplorerJson(baseUrl, `api/tools/${encodeURIComponent(language)}`);
}

export async function listCompilerExplorerLibraries(
  language: string,
  baseUrl = "https://godbolt.org/",
): Promise<unknown[]> {
  return getExplorerJson(
    baseUrl,
    `api/libraries/${encodeURIComponent(language)}`,
  );
}

export async function listCompilerExplorerCompilers(
  language: string,
  baseUrl = "https://godbolt.org/",
): Promise<CompilerInfo[]> {
  return getExplorerJson(
    baseUrl,
    `api/compilers/${encodeURIComponent(language)}?fields=id,name,lang,compilerType,semver,releaseTrack`,
  );
}

export async function compileWithCompilerExplorer(
  request: CompileRequest,
): Promise<CompilationResult> {
  const execute = request.execute !== false;
  if (!request.compiler)
    throw new Error(
      `A compiler must be configured for language “${request.language}”`,
    );
  const operation = request.buildSystem === "cmake" ? "cmake" : "compile";
  const endpoint = explorerUrl(
    request.baseUrl,
    `api/compiler/${encodeURIComponent(request.compiler)}/${operation}`,
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      source: request.source,
      files: request.files ?? [],
      compiler: request.compiler,
      lang: request.language,
      options: {
        userArguments: request.options,
        compilerOptions: {
          executorRequest: execute,
          overrides: request.overrides ?? [],
        },
        executeParameters: {
          args: splitArguments(request.run_args ?? ""),
          stdin: request.stdin ?? "",
          runtimeTools: [],
        },
        filters: { ...request.filters, execute },
        libraries: request.libraries ?? [],
        tools: request.tools ?? [],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Compiler service returned ${response.status}`);
  }
  return response.json() as Promise<CompilationResult>;
}

function explorerUrl(base: string, path: string): URL {
  const baseUrl = new URL(base);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  return new URL(path, baseUrl);
}

async function getExplorerJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(explorerUrl(baseUrl, path), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Compiler Explorer returned ${response.status}`);
  return response.json() as Promise<T>;
}

function splitArguments(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) result.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  if (current) result.push(current);
  return result;
}
