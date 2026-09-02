// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  findCodeBlockElements,
  optionsFromElement,
  readTabs,
} from "../src/codeblocks/element-options";
import { createCodeBlockView } from "../src/codeblocks/view";
import { createSimpleEditor } from "../src/editor/simple";

describe("declarative code block UI", () => {
  it("recognizes cb as inline/read-only and parses source windows", () => {
    const inline = document.createElement("cb");
    inline.setAttribute("simple", "");
    inline.setAttribute("src", "/answer.cpp");
    inline.setAttribute("range", "4:3-5:8");
    inline.setAttribute("compiler-explorer-link", "https://example.test/demo");
    document.body.append(inline);
    expect(findCodeBlockElements(document)).toContain(inline);
    expect(optionsFromElement(inline, {})).toMatchObject({
      inline: true,
      readOnly: true,
      simple: true,
      compilerExplorerLinkUrl: "https://example.test/demo",
    });
    expect(readTabs(inline, undefined)[0]).toMatchObject({
      src: "/answer.cpp",
      range: { startLine: 4, startColumn: 3, endLine: 5, endColumn: 8 },
    });
  });

  it("dedents embedded source without collapsing code whitespace", () => {
    const block = document.createElement("codeblock");
    block.textContent =
      "\n        int main() {\n            return 0;\n        }\n      ";
    expect(readTabs(block, undefined)[0].value).toBe(
      "int main() {\n    return 0;\n}",
    );
  });

  it("renders persistent fallback line highlights", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createSimpleEditor({
      element: host,
      value: "one\ntwo\nthree",
      highlightedLines: [2, 3],
    });
    expect(host.dataset.syntaxTheme).toBe("vscode-plus");
    expect(
      host.querySelectorAll(".clangd-fallback-line-highlights > span"),
    ).toHaveLength(2);
    editor.setHighlightedLines([1]);
    expect(
      host.querySelectorAll(".clangd-fallback-line-highlights > span"),
    ).toHaveLength(1);
    editor.dispose();
    expect(host.dataset.syntaxTheme).toBeUndefined();
  });

  it("floats info in the editor and suppresses a control-less toolbar", () => {
    const root = document.createElement("codeblock");
    const view = createCodeBlockView(
      root,
      [{ name: "main.cpp", value: "int main() {}" }],
      {
        outputPosition: "below",
        outputViews: ["execution"],
        editableOptions: false,
        activeTab: 0,
        integratedActions: false,
        ui: {
          toolbar: true,
          tabs: true,
          runButton: false,
          compilerExplorerLink: false,
          info: true,
          output: true,
        },
      },
      vi.fn(),
    );
    expect(view.info.parentElement).toBe(view.editorShell);
    expect(view.toolbar.hidden).toBe(true);
    expect(view.outputDrawer.dataset.syntaxTheme).toBe("vscode-plus");
  });

  it("integrates language and compiler selects ahead of the editor", () => {
    const root = document.createElement("codeblock");
    const view = createCodeBlockView(
      root,
      [{ name: "main.cpp", value: "int main() {}" }],
      {
        outputPosition: "below",
        outputViews: ["execution", "assembly"],
        editableOptions: true,
        activeTab: 0,
        integratedActions: false,
        ui: {
          toolbar: true,
          tabs: true,
          runButton: true,
          compilerExplorerLink: true,
          info: true,
          output: true,
        },
      },
      vi.fn(),
    );
    expect(view.settingFields.language).toBeInstanceOf(HTMLSelectElement);
    expect(view.settingFields.compiler).toBeInstanceOf(HTMLSelectElement);
    expect(view.settingFields.output).toBeUndefined();
    expect(
      view.settingsBar.compareDocumentPosition(view.workspace) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      view.workspace.compareDocumentPosition(view.toolbar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts live actions inside the output footer", () => {
    const root = document.createElement("codeblock");
    const view = createCodeBlockView(
      root,
      [{ name: "example.cpp", value: "int main() {}" }],
      {
        outputPosition: "side",
        outputViews: ["execution"],
        editableOptions: false,
        activeTab: 0,
        integratedActions: true,
        ui: {
          toolbar: true,
          tabs: true,
          runButton: true,
          compilerExplorerLink: true,
          info: true,
          output: true,
        },
      },
      vi.fn(),
    );
    expect(view.runButton.parentElement).toBe(view.outputFooter);
    expect(view.compilerLink.parentElement).toBe(view.outputFooter);
    expect(view.toolbar.hidden).toBe(true);
    expect(view.runButton.textContent).toBe("");
  });

  it("keeps hidden build files out of the visible tabs", () => {
    const root = document.createElement("codeblock");
    const cmake = document.createElement("codeblock-tab");
    cmake.setAttribute("name", "CMakeLists.txt");
    cmake.setAttribute("hidden", "");
    cmake.textContent = "project(example)";
    const main = document.createElement("codeblock-tab");
    main.setAttribute("name", "main.cpp");
    main.textContent = "int main() {}";
    root.append(cmake, main);
    document.body.append(root);
    const tabs = [
      { name: "CMakeLists.txt", value: "project(example)", hidden: true },
      { name: "main.cpp", value: "int main() {}", hidden: false },
    ];
    const view = createCodeBlockView(
      root,
      tabs,
      {
        outputPosition: "side",
        outputViews: ["assembly"],
        editableOptions: false,
        activeTab: 1,
        integratedActions: false,
        ui: {
          toolbar: false,
          tabs: true,
          runButton: false,
          compilerExplorerLink: false,
          info: false,
          output: true,
        },
      },
      vi.fn(),
    );
    expect(view.tabButtons[0].hidden).toBe(true);
    expect(view.tabButtons[1].getAttribute("aria-selected")).toBe("true");
    expect(view.tabBar.isConnected).toBe(false);
  });
});
