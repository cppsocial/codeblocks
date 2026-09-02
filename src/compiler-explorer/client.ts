import type { CompilationResult, CompileRequest } from "./types";

/** Compile and execute source, returning Compiler Explorer's structured result. */
export async function compileWithCompilerExplorer(
  request: CompileRequest,
): Promise<CompilationResult> {
  const baseUrl = new URL(request.baseUrl);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  const endpoint = new URL(
    `api/compiler/${encodeURIComponent(request.compiler)}/compile`,
    baseUrl,
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      source: request.source,
      compiler: request.compiler,
      lang: request.language,
      options: {
        userArguments: request.options,
        compilerOptions: { executorRequest: true },
        executeParameters: { args: [], stdin: "", runtimeTools: [] },
        filters: { execute: true },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Compiler service returned ${response.status}`);
  }
  return response.json() as Promise<CompilationResult>;
}
