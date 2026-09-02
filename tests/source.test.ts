import { describe, expect, it, vi } from "vitest";
import {
  appendTranslationUnits,
  fetchSource,
  parseHighlightedLines,
  parseRunline,
  parseSourceRange,
  selectSource,
} from "../src/codeblocks/source";

describe("source inputs", () => {
  it("selects line and column windows", () => {
    const source = "zero\none two three\nalpha beta\nlast";
    expect(selectSource(source, parseSourceRange("2:5-3:5"))).toBe(
      "two three\nalph",
    );
    expect(selectSource(source, parseSourceRange("2:5-2:7"))).toBe("tw");
    expect(selectSource("0123456789", parseSourceRange("1:2-1:5"))).toBe("123");
  });

  it("parses highlighted line lists and ranges", () => {
    expect(parseHighlightedLines("2-4, 7, 4")).toEqual([2, 3, 4, 7]);
    expect(() => parseHighlightedLines("two")).toThrow("Invalid highlighted");
  });

  it("removes and parses C++ and script runlines", () => {
    expect(parseRunline("// clang2110 -std=c++23 -O2\nint main() {}")).toEqual({
      source: "int main() {}",
      compiler: "clang2110",
      compilerArgs: "-std=c++23 -O2",
    });
    expect(parseRunline("# python311 -O\nprint('ok')").source).toBe(
      "print('ok')",
    );
    expect(parseRunline("#include <vector>\nint main() {}").source).toContain(
      "#include",
    );
    expect(
      parseRunline("// explain this example\nint main() {}").source,
    ).toContain("explain");
  });

  it("loads source URLs with useful failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("int x;")));
    await expect(fetchSource("/example.cpp")).resolves.toBe("int x;");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no", { status: 404 })),
    );
    await expect(fetchSource("/missing.cpp")).rejects.toThrow("(404)");
  });

  it("adds only missing translation units to compiler arguments", () => {
    expect(
      appendTranslationUnits("-O2", ["multiply.cpp", "multiply.h", "other.c"]),
    ).toBe("-O2 multiply.cpp other.c");
    expect(appendTranslationUnits("-O2 multiply.cpp", ["multiply.cpp"])).toBe(
      "-O2 multiply.cpp",
    );
    expect(appendTranslationUnits("", ["with space.cpp"])).toBe(
      '"with space.cpp"',
    );
  });
});
