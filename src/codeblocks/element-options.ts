import type {
  CompilerExplorerConfiguration,
  CompilerExplorerFilters,
} from "../compiler-explorer/types";
import type {
  CodeBlocksConfiguration,
  CodeBlockTheme,
  CreateCodeBlockOptions,
} from "./types";

export interface SourceTab {
  name: string;
  value: string;
}

export function findCodeBlockElements(root: ParentNode): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.localName === "codeblock") {
    elements.push(root);
  }
  elements.push(
    ...root.querySelectorAll<HTMLElement>(
      "codeblock:not([data-codeblocks-upgraded])",
    ),
  );
  return elements;
}

export function optionsFromElement(
  element: HTMLElement,
  configured: CodeBlocksConfiguration,
): CreateCodeBlockOptions {
  return {
    ...configured,
    element,
    theme: attributeTheme(element) ?? configured.theme,
    showDebugControls:
      element.hasAttribute("debug") || configured.showDebugControls,
    compiler: element.getAttribute("compiler") ?? configured.compiler,
    args: element.getAttribute("args") ?? configured.args,
    compilerExplorer: compilerExplorerAttributes(
      element,
      configured.compilerExplorer,
    ),
  };
}

export function readTabs(
  element: HTMLElement,
  explicitValue: string | undefined,
): SourceTab[] {
  if (explicitValue !== undefined) {
    return [{ name: "main.cpp", value: explicitValue }];
  }
  const tabElements = Array.from(
    element.querySelectorAll<HTMLElement>(":scope > codeblock-tab"),
  );
  if (!tabElements.length) {
    return [{
      name: element.getAttribute("filename") ?? "main.cpp",
      value: sourceFromElement(element),
    }];
  }
  return tabElements.map((tab, index) => ({
    name:
      tab.getAttribute("name") ??
      tab.getAttribute("filename") ??
      `File ${index + 1}`,
    value: sourceFromElement(tab),
  }));
}

function sourceFromElement(element: HTMLElement): string {
  const source = element.textContent ?? "";
  return source.startsWith("\n")
    ? source.slice(1).replace(/[ \t]*\n?$/, "")
    : source;
}

function attributeTheme(element: HTMLElement): CodeBlockTheme | undefined {
  const value = element.getAttribute("theme");
  return value === "auto" || value === "light" || value === "dark"
    ? value
    : undefined;
}

function compilerExplorerAttributes(
  element: HTMLElement,
  configured: CompilerExplorerConfiguration | undefined,
): CompilerExplorerConfiguration | undefined {
  const baseUrl = element.getAttribute("ce-url");
  const language = element.getAttribute("ce-language");
  const compiler = element.getAttribute("ce-compiler");
  const options = element.getAttribute("ce-options");
  const filters = jsonAttribute<Partial<CompilerExplorerFilters>>(
    element,
    "ce-filters",
  );
  if (!configured && !baseUrl && !language && !compiler && !options && !filters) {
    return undefined;
  }
  return {
    ...configured,
    ...(baseUrl && { baseUrl }),
    ...(language && { language }),
    ...(compiler && { compiler }),
    ...(options && { options }),
    filters: { ...configured?.filters, ...filters },
  };
}

function jsonAttribute<T>(element: HTMLElement, name: string): T | undefined {
  const value = element.getAttribute(name);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`${name} must contain valid JSON: ${message}`);
  }
}
