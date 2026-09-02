import type {
  CompilerExplorerConfiguration,
  CompilerExplorerFilters,
} from "../compiler-explorer/types";
import type {
  CodeBlockAction,
  CodeBlockEditableOption,
  CodeBlockOutputPosition,
  CodeBlockOutputView,
  CodeBlocksConfiguration,
  CodeBlockTheme,
  CreateCodeBlockOptions,
} from "./types";
import {
  parseHighlightedLines,
  parseSourceRange,
  type SourceRange,
} from "./source";

export interface SourceTab {
  name: string;
  value: string;
  src?: string;
  hidden?: boolean;
  range?: SourceRange;
  highlightedLines?: number[];
}

export function findCodeBlockElements(root: ParentNode): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (
    root instanceof HTMLElement &&
    (root.localName === "codeblock" || root.localName === "cb")
  ) {
    elements.push(root);
  }
  elements.push(
    ...root.querySelectorAll<HTMLElement>(
      "codeblock:not([data-codeblocks-upgraded]), cb:not([data-codeblocks-upgraded])",
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
    language: element.getAttribute("language") ?? configured.language,
    compiler: element.getAttribute("compiler") ?? configured.compiler,
    compiler_args:
      element.getAttribute("compiler-args") ??
      element.getAttribute("compiler_args") ??
      element.getAttribute("args") ??
      configured.compiler_args ??
      configured.compilerArgs ??
      configured.args,
    run_args:
      element.getAttribute("run-args") ??
      element.getAttribute("run_args") ??
      configured.run_args ??
      configured.runArgs,
    stdin: element.getAttribute("stdin") ?? configured.stdin,
    readOnly:
      element.localName === "cb"
        ? true
        : booleanAttribute(element, "readonly", configured.readOnly),
    inline:
      element.localName === "cb"
        ? true
        : booleanAttribute(element, "inline", configured.inline),
    simple: booleanAttribute(element, "simple", configured.simple),
    deferMonaco: element.hasAttribute("eager") ? false : configured.deferMonaco,
    fit: fitAttribute(element) ?? configured.fit,
    buildSystem:
      enumAttribute(element, "build-system", ["cmake"] as const) ??
      configured.buildSystem,
    multiFile: booleanAttribute(element, "multi-file", configured.multiFile),
    action:
      enumAttribute(element, "action", [
        "run",
        "compile",
        "disassemble",
      ] as const) ?? configured.action,
    outputViews:
      (listAttribute(element, "output-views") as
        CodeBlockOutputView[] | undefined) ?? configured.outputViews,
    outputPosition:
      (enumAttribute(element, "output-position", [
        "below",
        "side",
        "custom",
      ] as const) as CodeBlockOutputPosition | undefined) ??
      configured.outputPosition,
    live: liveAttribute(element) ?? configured.live,
    editableOptions:
      editableOptionsAttribute(element) ?? configured.editableOptions,
    editorOptions:
      jsonAttribute<Record<string, unknown>>(element, "editor-options") ??
      configured.editorOptions,
    styles:
      jsonAttribute<Record<string, string>>(element, "styles") ??
      configured.styles,
    renderOutput: element.hasAttribute("no-render-output")
      ? false
      : configured.renderOutput,
    info: {
      ...configured.info,
      ...(element.getAttribute("info-name") && {
        name: element.getAttribute("info-name")!,
      }),
      ...(element.getAttribute("info-description") && {
        description: element.getAttribute("info-description")!,
      }),
      ...(element.getAttribute("source-url") && {
        sourceUrl: element.getAttribute("source-url")!,
      }),
    },
    ui: {
      ...configured.ui,
      toolbar: visibilityAttribute(element, "toolbar", configured.ui?.toolbar),
      tabs: visibilityAttribute(element, "tabs", configured.ui?.tabs),
      runButton: visibilityAttribute(element, "run", configured.ui?.runButton),
      compilerExplorerLink: visibilityAttribute(
        element,
        "compiler-explorer",
        configured.ui?.compilerExplorerLink,
      ),
      info: visibilityAttribute(element, "info", configured.ui?.info),
      output: visibilityAttribute(element, "output", configured.ui?.output),
    },
    compilerExplorer: compilerExplorerAttributes(
      element,
      configured.compilerExplorer,
    ),
    compilerExplorerLinkUrl:
      element.getAttribute("compiler-explorer-link") ??
      configured.compilerExplorerLinkUrl,
  };
}

function fitAttribute(element: HTMLElement): CreateCodeBlockOptions["fit"] {
  if (!element.hasAttribute("fit")) return undefined;
  const value = element.getAttribute("fit");
  return value === "height" || value === "width" || value === "both"
    ? value
    : true;
}

function booleanAttribute(
  element: HTMLElement,
  name: string,
  configured: boolean | undefined,
): boolean | undefined {
  return element.hasAttribute(name) ? true : configured;
}

function visibilityAttribute(
  element: HTMLElement,
  name: string,
  configured: boolean | undefined,
): boolean | undefined {
  if (element.hasAttribute(`hide-${name}`)) return false;
  if (element.hasAttribute(`show-${name}`)) return true;
  return configured;
}

function enumAttribute<const T extends readonly string[]>(
  element: HTMLElement,
  name: string,
  values: T,
): T[number] | undefined {
  const value = element.getAttribute(name);
  return value && (values as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function listAttribute(
  element: HTMLElement,
  name: string,
): string[] | undefined {
  const value = element.getAttribute(name);
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

function liveAttribute(element: HTMLElement): boolean | number | undefined {
  if (!element.hasAttribute("live")) return undefined;
  const value = element.getAttribute("live") ?? "";
  if (!value) return true;
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? milliseconds
    : true;
}

function editableOptionsAttribute(
  element: HTMLElement,
): boolean | CodeBlockEditableOption[] | undefined {
  if (!element.hasAttribute("editable-options")) return undefined;
  const values = listAttribute(element, "editable-options");
  return values?.length ? (values as CodeBlockEditableOption[]) : true;
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
    return [
      {
        name: element.getAttribute("filename") ?? "main.cpp",
        value: sourceFromElement(element),
        ...(element.getAttribute("src") && {
          src: element.getAttribute("src")!,
        }),
        range: rangeFromElement(element),
        highlightedLines: parseHighlightedLines(
          element.getAttribute("highlight-lines") ?? undefined,
        ),
      },
    ];
  }
  return tabElements.map((tab, index) => ({
    name:
      tab.getAttribute("name") ??
      tab.getAttribute("filename") ??
      `File ${index + 1}`,
    value: sourceFromElement(tab),
    ...(tab.getAttribute("src") && { src: tab.getAttribute("src")! }),
    hidden: tab.hasAttribute("hidden"),
    range: rangeFromElement(tab),
    highlightedLines: parseHighlightedLines(
      tab.getAttribute("highlight-lines") ?? undefined,
    ),
  }));
}

function rangeFromElement(element: HTMLElement): SourceRange | undefined {
  const compact = parseSourceRange(element.getAttribute("range"));
  const number = (name: string) => {
    const value = element.getAttribute(name);
    return value ? Number(value) : undefined;
  };
  const explicit: SourceRange = {
    startLine: number("start-line"),
    endLine: number("end-line"),
    startColumn: number("start-column"),
    endColumn: number("end-column"),
  };
  return (
    compact ??
    (Object.values(explicit).some((value) => value !== undefined)
      ? explicit
      : undefined)
  );
}

function sourceFromElement(element: HTMLElement): string {
  const source = element.textContent ?? "";
  const trimmed = source.replace(/^\s*\n/, "").replace(/\n[ \t]*$/, "");
  const nonEmpty = trimmed.split("\n").filter((line) => line.trim());
  const indent = nonEmpty.length
    ? Math.min(
        ...nonEmpty.map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0),
      )
    : 0;
  return indent
    ? trimmed
        .split("\n")
        .map((line) =>
          line.slice(Math.min(indent, line.match(/^[ \t]*/)?.[0].length ?? 0)),
        )
        .join("\n")
    : trimmed;
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
  const libs = jsonAttribute<unknown[]>(element, "ce-libs");
  const specialoutputs = jsonAttribute<string[]>(element, "ce-special-outputs");
  const tools = jsonAttribute<unknown[]>(element, "ce-tools");
  const overrides = jsonAttribute<unknown[]>(element, "ce-overrides");
  if (
    !configured &&
    !baseUrl &&
    !language &&
    !compiler &&
    !options &&
    !filters &&
    !libs &&
    !specialoutputs &&
    !tools &&
    !overrides
  ) {
    return undefined;
  }
  return {
    ...configured,
    ...(baseUrl && { baseUrl }),
    ...(language && { language }),
    ...(compiler && { compiler }),
    ...(options && { options }),
    filters: { ...configured?.filters, ...filters },
    ...(libs && { libs }),
    ...(specialoutputs && { specialoutputs }),
    ...(tools && { tools }),
    ...(overrides && { overrides }),
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
