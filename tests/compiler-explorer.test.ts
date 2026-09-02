import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileWithCompilerExplorer,
  listCompilerExplorerCompilers,
} from "../src/compiler-explorer/client";
import {
  createCompilerExplorerUrl,
  resolveCompilerExplorerTarget,
} from "../src/compiler-explorer/state";

afterEach(() => vi.unstubAllGlobals());

describe("Compiler Explorer integration", () => {
  it("keeps defaults language-specific", () => {
    expect(resolveCompilerExplorerTarget({ language: "c++" }).compiler).toBe(
      "clang2110",
    );
    expect(resolveCompilerExplorerTarget({ language: "python" })).toMatchObject(
      { compiler: "", options: "" },
    );
  });

  it("sends extra files and execution through one compiler request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ didExecute: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await compileWithCompilerExplorer({
      baseUrl: "https://godbolt.org/",
      language: "c++",
      compiler: "clang2110",
      options: "-O2",
      source: '#include "extra.h"',
      files: [{ filename: "extra.h", contents: "inline int n = 1;" }],
      execute: true,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.files).toEqual([
      { filename: "extra.h", contents: "inline int n = 1;" },
    ]);
    expect(body.options.filters.execute).toBe(true);
    expect(body.options.compilerOptions.executorRequest).toBe(true);
  });

  it("creates client state with compiler execution enabled and no executor pane", () => {
    const url = createCompilerExplorerUrl("int main() {}", "main.cpp", {
      compiler: "clang2110",
      execute: true,
    });
    const encoded = new URL(url).pathname.split("/clientstate/")[1];
    const state = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(state.sessions[0].compilers[0].filters).toMatchObject({
      execute: true,
      libraryCode: false,
    });
    expect(state.sessions[0].executors).toEqual([]);
  });

  it("creates Compiler Explorer tree state for multi-file and CMake links", () => {
    const url = createCompilerExplorerUrl(
      "project(example)",
      "CMakeLists.txt",
      {
        compiler: "clang2110",
        execute: false,
        buildSystem: "cmake",
        files: [{ filename: "main.cpp", contents: "int main() {}" }],
      },
    );
    const encoded = new URL(url).pathname.split("/clientstate/")[1];
    const state = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(state.sessions).toEqual([
      expect.objectContaining({ id: 1, filename: "CMakeLists.txt" }),
      expect.objectContaining({ id: 2, filename: "main.cpp" }),
    ]);
    expect(state.trees[0]).toMatchObject({
      buildSystem: "cmake",
      isCMakeProject: true,
      files: [
        { filename: "CMakeLists.txt", isMainSource: true, editorId: 1 },
        { filename: "main.cpp", isIncluded: true, editorId: 2 },
      ],
      executors: [],
    });
  });

  it("opens multi-file source views with an executor and no assembly pane", () => {
    const url = createCompilerExplorerUrl("int main() {}", "main.cpp", {
      compiler: "clang2110",
      execute: true,
      compiler_args: "-O2",
      run_args: '--name "Ada Lovelace"',
      stdin: "input\n",
      files: [{ filename: "answer.h", contents: "constexpr int answer = 42;" }],
    });
    const encoded = new URL(url).pathname.split("/clientstate/")[1];
    const state = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(
      state.sessions.map((session: { filename: string }) => session.filename),
    ).toEqual(["example.cpp", "answer.h"]);
    expect(state.trees[0].files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: "example.cpp",
          isMainSource: true,
          isOpen: true,
          editorId: 1,
        }),
      ]),
    );
    expect(state.trees[0].compilers).toEqual([]);
    expect(state.trees[0].executors).toEqual([
      {
        arguments: '--name "Ada Lovelace"',
        compiler: {
          id: "clang2110",
          libs: [],
          options: "-O2",
          overrides: [],
        },
        stdin: "input\n",
      },
    ]);
  });

  it("keeps an assembly compiler for non-executable multi-file links", () => {
    const url = createCompilerExplorerUrl(
      "int answer() { return 42; }",
      "answer.cpp",
      {
        compiler: "clang2110",
        execute: false,
        files: [{ filename: "answer.h", contents: "int answer();" }],
      },
    );
    const encoded = new URL(url).pathname.split("/clientstate/")[1];
    const state = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(state.trees[0].executors).toEqual([]);
    expect(state.trees[0].compilers[0].filters).toMatchObject({
      execute: false,
      libraryCode: false,
    });
  });

  it("discovers compilers by language", async () => {
    const payload = [{ id: "clang", name: "Clang", lang: "c++" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listCompilerExplorerCompilers("c++")).resolves.toEqual(
      payload,
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "api/compilers/c%2B%2B",
    );
  });
});
