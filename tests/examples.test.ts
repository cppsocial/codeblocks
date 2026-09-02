import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("published examples", () => {
  it("preserves embedded source whitespace across formatting", async () => {
    const html = await readFile("public/index.html", "utf8");
    expect(html).toContain("<!-- prettier-ignore -->\n      <codeblock");
    expect(html).toContain(
      '#include &lt;print&gt;\nint main() {\n    std::println("foo {} bar", 42);\n}',
    );
  });

  it("contains URL, source-window, highlighting, and multi-file examples", async () => {
    const html = await readFile("public/examples/index.html", "utf8");
    expect(html).toContain('src="./sources/url-example.cpp"');
    expect(html).toContain('range="3-7"');
    expect(html).toContain('highlight-lines="4-5"');
    expect(html).toContain("multi-file");
    expect(html).toContain('src="./sources/multiply.h" hidden');
    expect(html).toContain("Multi-file run from URL-backed tabs");
    expect(html).toContain("Simple editors");
    expect(html).toContain('language="c++" simple');
    expect(html).toContain("Live execution output");
    expect(html).toContain('output-views="execution,compiler"');
  });
});
