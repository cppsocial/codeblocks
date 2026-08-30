import type { editor as MonacoEditor } from "monaco-editor";
import { appendAnsi } from "./ansi";
import { createCppFallbackEditor, type CppFallbackEditor } from "./fallback";
import type { CppEditor, EditorStatus } from "./runtime";
import "./codeblocks.css";

export type CodeBlockTheme = "auto" | "light" | "dark";

export interface CompilerExplorerFilters {
  binary: boolean;
  binaryObject: boolean;
  commentOnly: boolean;
  demangle: boolean;
  directives: boolean;
  execute: boolean;
  intel: boolean;
  labels: boolean;
  libraryCode: boolean;
  trim: boolean;
  debugCalls: boolean;
}

export interface CompilerExplorerConfiguration {
  baseUrl?: string;
  language?: string;
  compiler?: string;
  options?: string;
  filters?: Partial<CompilerExplorerFilters>;
  libs?: unknown[];
  specialoutputs?: string[];
  tools?: unknown[];
  overrides?: unknown[];
}

export interface CodeBlocksConfiguration {
  theme?: CodeBlockTheme;
  showDebugControls?: boolean;
  compiler?: string;
  args?: string;
  compilerExplorer?: CompilerExplorerConfiguration;
  /** @deprecated Use compilerExplorer.baseUrl. */
  compilerExplorerUrl?: string;
  editorOptions?: MonacoEditor.IStandaloneEditorConstructionOptions;
  styles?: Record<string, string>;
  onStatus?: (status: EditorStatus) => void;
}

export interface CreateCodeBlockOptions extends CodeBlocksConfiguration {
  element: HTMLElement;
  value?: string;
}

export interface CodeBlock {
  getValue(): string;
  setValue(value: string): void;
  getTabs(): Array<{ name: string; value: string }>;
  selectTab(tab: string | number): void;
  getCompilerExplorerUrl(): string;
  focus(): void;
  run(): Promise<void>;
  setTheme(theme: CodeBlockTheme): Promise<void>;
  dispose(): void;
  onDidChange(callback: (value: string) => void): () => void;
  editorReady: Promise<CppEditor>;
  monacoReady: Promise<MonacoEditor.IStandaloneCodeEditor>;
  clangdReady: Promise<void>;
}

const instances = new WeakMap<HTMLElement, CodeBlock>();
let configuration: CodeBlocksConfiguration = {};
let observer: MutationObserver | undefined;

export function configureCodeBlocks(options: CodeBlocksConfiguration): void {
  configuration = { ...configuration, ...options };
}

export function getCodeBlock(element: HTMLElement): CodeBlock | undefined {
  return instances.get(element);
}

export function startCodeBlocks(root: ParentNode = document): void {
  upgradeWithin(root);
  if (observer || root !== document) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) upgradeWithin(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function createCodeBlock(options: CreateCodeBlockOptions): CodeBlock {
  if (!(options.element instanceof HTMLElement)) {
    throw new TypeError("createCodeBlock requires an HTMLElement");
  }

  const root = options.element;
  const tabs = readTabs(root, options.value);
  let activeTab = 0;
  const initialValue = tabs[0].value;
  const tabBar = document.createElement("div");
  tabBar.className = "codeblocks-tabs";
  tabBar.setAttribute("role", "tablist");
  tabBar.setAttribute("aria-label", "Source files");
  const tabButtons = tabs.map((tab, index) => {
    const tabButton = button(tab.name, true);
    tabButton.className = "codeblocks-tab";
    tabButton.dataset.tabIndex = String(index);
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-selected", index === 0 ? "true" : "false");
    tabButton.tabIndex = index === 0 ? 0 : -1;
    tabButton.addEventListener("click", () => selectTab(index));
    tabBar.append(tabButton);
    return tabButton;
  });
  const editorShell = document.createElement("div");
  editorShell.className = "codeblocks-editor-shell";
  const fallbackHost = document.createElement("div");
  fallbackHost.className = "codeblocks-fallback";
  fallbackHost.dataset.fallback = "";
  const monacoHost = document.createElement("div");
  monacoHost.className = "codeblocks-monaco";
  monacoHost.dataset.monacoHost = "";
  monacoHost.setAttribute("aria-label", "C++ code editor");
  editorShell.append(fallbackHost, monacoHost);

  const toolbar = document.createElement("div");
  toolbar.className = "codeblocks-toolbar";
  const runButton = button("Run");
  runButton.dataset.run = "";
  const debugControls = document.createElement("span");
  debugControls.className = "codeblocks-debug";
  debugControls.hidden = !options.showDebugControls;
  const editorToggle = button("Show basic editor", true);
  editorToggle.dataset.editorToggle = "";
  editorToggle.disabled = true;
  const themeToggle = button("Use light theme", true);
  themeToggle.dataset.themeToggle = "";
  debugControls.append(editorToggle, themeToggle);
  const compilerLink = document.createElement("a");
  compilerLink.className = "codeblocks-compiler-link";
  compilerLink.target = "_blank";
  compilerLink.rel = "noopener";
  compilerLink.append("View on Compiler Explorer", externalLinkIcon());
  toolbar.append(runButton, debugControls, compilerLink);

  const outputDrawer = document.createElement("section");
  outputDrawer.className = "codeblocks-output";
  outputDrawer.dataset.outputDrawer = "";
  outputDrawer.hidden = true;
  outputDrawer.setAttribute("aria-live", "polite");
  const outputHeader = document.createElement("header");
  outputHeader.textContent = "Output";
  const output = document.createElement("pre");
  output.dataset.output = "";
  outputDrawer.append(outputHeader, output);

  root.classList.add("codeblocks-root");
  root.replaceChildren(...(tabs.length > 1 ? [tabBar] : []), editorShell, toolbar, outputDrawer);
  const requestedWidth = root.getAttribute("width");
  const requestedHeight = root.getAttribute("height");
  const requestedMinHeight = root.getAttribute("min-height");
  if (requestedWidth) root.style.width = requestedWidth;
  if (requestedHeight) root.style.setProperty("--codeblocks-editor-height", requestedHeight);
  if (requestedMinHeight) {
    root.style.setProperty("--codeblocks-editor-min-height", requestedMinHeight);
  }
  for (const [name, value] of Object.entries(options.styles ?? {})) {
    root.style.setProperty(name.startsWith("--") ? name : `--codeblocks-${name}`, value);
  }

  let themeMode = options.theme ?? "auto";
  let resolvedTheme = resolveTheme(themeMode);
  root.dataset.theme = resolvedTheme;
  updateThemeButton();

  let fallback: CppFallbackEditor | undefined = createCppFallbackEditor({
    element: fallbackHost,
    value: initialValue,
  });
  let editor: CppEditor | undefined;
  let activeEditor: Pick<CppEditor, "getValue" | "setValue" | "focus"> = fallback;
  let disposed = false;
  let lastLoggedDownload = -1;
  const changeListeners = new Set<(value: string) => void>();
  let unsubscribeActive = fallback.onDidChange(notifyChange);
  compilerLink.href = getCompilerExplorerUrl();

  let resolveClangd!: () => void;
  let rejectClangd!: (error: unknown) => void;
  const clangdReady = new Promise<void>((resolve, reject) => {
    resolveClangd = resolve;
    rejectClangd = reject;
  });
  void clangdReady.catch(() => {});

  runButton.addEventListener("click", run);
  compilerLink.addEventListener("click", updateCompilerExplorerLink);
  compilerLink.addEventListener("pointerdown", updateCompilerExplorerLink);
  compilerLink.addEventListener("focus", updateCompilerExplorerLink);
  editorToggle.addEventListener("click", toggleEditor);
  themeToggle.addEventListener("click", toggleTheme);
  const media = matchMedia("(prefers-color-scheme: dark)");
  const systemThemeChanged = () => {
    if (themeMode === "auto") void setTheme("auto");
  };
  media.addEventListener("change", systemThemeChanged);
  const resizeObserver = new ResizeObserver(() => editor?.layout());
  resizeObserver.observe(editorShell);

  const editorReady = upgradeEditor();
  const monacoReady = editorReady.then((created) => created.getMonacoEditor());
  void editorReady.catch((error: unknown) => {
    if (options.showDebugControls) {
      console.error("[CodeBlocks] Editor failed", error);
    }
    rejectClangd(error);
  });

  async function upgradeEditor(): Promise<CppEditor> {
    const { createCppEditor } = await import("./runtime");
    const created = await createCppEditor({
      element: monacoHost,
      value: fallback?.getValue() ?? initialValue,
      theme: resolvedTheme,
      editorOptions: options.editorOptions,
      onStatus: reportStatus,
    });
    if (disposed) {
      created.dispose();
      throw new Error("Code block was disposed while the editor was loading");
    }

    editor = created;
    created.setValue(fallback?.getValue() ?? created.getValue());
    await created.setTheme(resolvedTheme);
    monacoHost.style.background = themeBackground(resolvedTheme);
    created.layout();
    await afterPaint();
    monacoHost.dataset.ready = "";
    await afterPaint();
    removeFallback();
    activeEditor = created;
    subscribeToActive(created);
    editorToggle.disabled = false;
    created.clangdReady.then(resolveClangd, rejectClangd);
    return created;
  }

  function reportStatus(event: EditorStatus): void {
    if (options.showDebugControls) {
      if (event.type !== "clangd-downloading") {
        logStatus(event);
      } else {
        const milestone = event.total
          ? Math.floor((event.loaded / event.total) * 10) * 10
          : Math.floor(event.loaded / (5 * 1024 * 1024));
        if (milestone !== lastLoggedDownload) {
          lastLoggedDownload = milestone;
          logStatus(event);
        }
      }
    }
    options.onStatus?.(event);
  }

  async function run(): Promise<void> {
    if (disposed || runButton.disabled) return;
    runButton.disabled = true;
    runButton.textContent = "Running...";
    outputDrawer.hidden = false;
    output.textContent = "Compiling...";
    try {
      const result = await executeCode(
        activeEditor.getValue(),
        options.compiler ?? "clang2110",
        options.args ?? "-std=c++2c -Wall -Wextra -pedantic-errors",
      );
      const diagnostics = joinLines(result.buildResult?.stderr);
      const stdout = joinLines(result.stdout);
      const stderr = joinLines(result.stderr);
      output.replaceChildren();
      if (result.didExecute) {
        if (!stdout && !stderr) output.textContent = "Program completed with no output.";
        else {
          appendAnsi(output, stdout);
          if (stdout && stderr) output.append("\n");
          appendAnsi(output, stderr, { className: "codeblocks-stderr" });
        }
      } else {
        appendAnsi(output, diagnostics || "Compilation failed without diagnostics.");
      }
    } catch (error) {
      output.textContent = `Run failed: ${errorMessage(error)}`;
    } finally {
      runButton.disabled = false;
      runButton.textContent = "Run";
    }
  }

  function toggleEditor(): void {
    if (!editor) return;
    if (fallback) {
      editor.setValue(fallback.getValue());
      removeFallback();
      monacoHost.hidden = false;
      monacoHost.dataset.ready = "";
      editor.layout();
      activeEditor = editor;
      subscribeToActive(editor);
      editorToggle.textContent = "Show basic editor";
    } else {
      monacoHost.hidden = true;
      delete monacoHost.dataset.ready;
      fallback = createCppFallbackEditor({ element: fallbackHost, value: editor.getValue() });
      editorShell.prepend(fallbackHost);
      activeEditor = fallback;
      subscribeToActive(fallback);
      editorToggle.textContent = "Show full editor";
    }
  }

  function toggleTheme(): void {
    void setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  async function setTheme(theme: CodeBlockTheme): Promise<void> {
    themeMode = theme;
    resolvedTheme = resolveTheme(theme);
    root.dataset.theme = resolvedTheme;
    monacoHost.style.background = themeBackground(resolvedTheme);
    updateThemeButton();
    await editor?.setTheme(resolvedTheme);
  }

  function updateThemeButton(): void {
    themeToggle.textContent = resolvedTheme === "dark" ? "Use light theme" : "Use dark theme";
  }

  function removeFallback(): void {
    if (!fallback) return;
    fallback.dispose();
    fallback = undefined;
    fallbackHost.remove();
  }

  function subscribeToActive(source: CppEditor | CppFallbackEditor): void {
    unsubscribeActive();
    unsubscribeActive = source.onDidChange(notifyChange);
  }

  function notifyChange(value: string): void {
    tabs[activeTab].value = value;
    changeListeners.forEach((listener) => listener(value));
  }

  function getCompilerExplorerUrl(): string {
    return createCompilerExplorerUrl(
      activeEditor.getValue(),
      tabs[activeTab].name,
      options,
    );
  }

  function updateCompilerExplorerLink(): void {
    compilerLink.href = getCompilerExplorerUrl();
  }

  function selectTab(tab: string | number): void {
    const index = typeof tab === "number"
      ? tab
      : tabs.findIndex((candidate) => candidate.name === tab);
    if (index < 0 || index >= tabs.length || index === activeTab) return;
    tabs[activeTab].value = activeEditor.getValue();
    activeTab = index;
    activeEditor.setValue(tabs[index].value);
    tabButtons.forEach((tabButton, buttonIndex) => {
      const selected = buttonIndex === index;
      tabButton.setAttribute("aria-selected", selected ? "true" : "false");
      tabButton.tabIndex = selected ? 0 : -1;
    });
    activeEditor.focus();
  }

  const instance: CodeBlock = {
    getValue: () => activeEditor.getValue(),
    setValue(value) {
      tabs[activeTab].value = value;
      activeEditor.setValue(value);
    },
    getTabs: () => tabs.map((tab, index) => ({
      name: tab.name,
      value: index === activeTab ? activeEditor.getValue() : tab.value,
    })),
    selectTab,
    getCompilerExplorerUrl,
    focus: () => activeEditor.focus(),
    run,
    setTheme,
    dispose() {
      if (disposed) return;
      disposed = true;
      runButton.removeEventListener("click", run);
      compilerLink.removeEventListener("click", updateCompilerExplorerLink);
      compilerLink.removeEventListener("pointerdown", updateCompilerExplorerLink);
      compilerLink.removeEventListener("focus", updateCompilerExplorerLink);
      editorToggle.removeEventListener("click", toggleEditor);
      themeToggle.removeEventListener("click", toggleTheme);
      media.removeEventListener("change", systemThemeChanged);
      resizeObserver.disconnect();
      unsubscribeActive();
      changeListeners.clear();
      fallback?.dispose();
      editor?.dispose();
      root.replaceChildren();
      root.classList.remove("codeblocks-root");
      delete root.dataset.theme;
      delete root.dataset.codeblocksUpgraded;
      instances.delete(root);
    },
    onDidChange(callback) {
      changeListeners.add(callback);
      return () => changeListeners.delete(callback);
    },
    editorReady,
    monacoReady,
    clangdReady,
  };
  instances.set(root, instance);
  return instance;
}

function upgradeWithin(root: ParentNode): void {
  const elements: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.localName === "codeblock") elements.push(root);
  elements.push(...root.querySelectorAll<HTMLElement>("codeblock:not([data-codeblocks-upgraded])"));
  for (const element of elements) {
    if (element.dataset.codeblocksUpgraded !== undefined) continue;
    element.dataset.codeblocksUpgraded = "";
    const instance = createCodeBlock({
      ...configuration,
      element,
      theme: attributeTheme(element) ?? configuration.theme,
      showDebugControls: element.hasAttribute("debug") || configuration.showDebugControls,
      compiler: element.getAttribute("compiler") ?? configuration.compiler,
      args: element.getAttribute("args") ?? configuration.args,
      compilerExplorer: compilerExplorerAttributes(
        element,
        configuration.compilerExplorer,
      ),
    });
    instances.set(element, instance);
  }
}

function sourceFromElement(element: HTMLElement): string {
  const source = element.textContent ?? "";
  return source.startsWith("\n") ? source.slice(1).replace(/[ \t]*\n?$/, "") : source;
}

function readTabs(
  element: HTMLElement,
  explicitValue: string | undefined,
): Array<{ name: string; value: string }> {
  if (explicitValue !== undefined) return [{ name: "main.cpp", value: explicitValue }];
  const tabElements = Array.from(
    element.querySelectorAll<HTMLElement>(":scope > codeblock-tab"),
  );
  if (!tabElements.length) {
    return [{ name: element.getAttribute("filename") ?? "main.cpp", value: sourceFromElement(element) }];
  }
  return tabElements.map((tab, index) => ({
    name: tab.getAttribute("name") ?? tab.getAttribute("filename") ?? `File ${index + 1}`,
    value: sourceFromElement(tab),
  }));
}

function attributeTheme(element: HTMLElement): CodeBlockTheme | undefined {
  const value = element.getAttribute("theme");
  return value === "auto" || value === "light" || value === "dark" ? value : undefined;
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
    throw new SyntaxError(
      `${name} must contain valid JSON: ${errorMessage(error)}`,
    );
  }
}

function button(label: string, secondary = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (secondary) element.className = "codeblocks-secondary";
  return element;
}

function externalLinkIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M9 2h5v5M14 2 7.5 8.5M12 9.5V14H2V4h4.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "1.5");
  svg.append(path);
  return svg;
}

function resolveTheme(theme: CodeBlockTheme): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function themeBackground(theme: "light" | "dark"): string {
  return theme === "light" ? "#ffffff" : "#1e1e1e";
}

function afterPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logStatus(event: EditorStatus): void {
  if (event.type === "monaco-loading") {
    console.info("[CodeBlocks] Monaco loading");
  } else if (event.type === "monaco-ready") {
    console.info("[CodeBlocks] Monaco loaded");
  } else if (event.type === "clangd-downloading") {
    const progress = event.total
      ? `${formatMegabytes(event.loaded)} MB / ${formatMegabytes(event.total)} MB`
      : `${formatMegabytes(event.loaded)} MB downloaded`;
    console.info(`[CodeBlocks] clangd downloading: ${progress}`);
  } else if (event.type === "clangd-starting") {
    console.info("[CodeBlocks] clangd starting");
  } else if (event.type === "clangd-loaded") {
    console.info("[CodeBlocks] clangd loaded");
  } else if (event.type === "clangd-ready") {
    console.info("[CodeBlocks] clangd activated");
  } else if (event.type === "clangd-error") {
    console.error(`[CodeBlocks] clangd error: ${event.error.message}`, event.error);
  }
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

const DEFAULT_COMPILER_EXPLORER_FILTERS: CompilerExplorerFilters = {
  binary: false,
  binaryObject: false,
  commentOnly: true,
  demangle: true,
  directives: true,
  execute: false,
  intel: true,
  labels: true,
  libraryCode: false,
  trim: false,
  debugCalls: false,
};

function createCompilerExplorerUrl(
  source: string,
  filename: string,
  options: CreateCodeBlockOptions,
): string {
  const explorer = options.compilerExplorer ?? {};
  const compiler = explorer.compiler ?? options.compiler ?? "clang2110";
  const compilerOptions = explorer.options ?? options.args ??
    "-std=c++2c -Wall -Wextra -pedantic-errors";
  const state = {
    sessions: [{
      id: 1,
      language: explorer.language ?? "c++",
      source,
      filename,
      compilers: [{
        id: compiler,
        options: compilerOptions,
        filters: {
          ...DEFAULT_COMPILER_EXPLORER_FILTERS,
          ...explorer.filters,
        },
        libs: explorer.libs ?? [],
        specialoutputs: explorer.specialoutputs ?? [],
        tools: explorer.tools ?? [],
        overrides: explorer.overrides ?? [],
      }],
      executors: [],
    }],
    trees: [],
  };
  const baseUrl = new URL(
    explorer.baseUrl ?? options.compilerExplorerUrl ?? "https://godbolt.org/",
  );
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  return new URL(`clientstate/${base64Url(JSON.stringify(state))}`, baseUrl).href;
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface CompilerLine { text: string }
interface CompilerResult {
  didExecute: boolean;
  stdout?: CompilerLine[];
  stderr?: CompilerLine[];
  buildResult?: { stderr?: CompilerLine[] };
}

function joinLines(lines: CompilerLine[] = []): string {
  return lines.map((line) => line.text).join("\n");
}

async function executeCode(
  source: string,
  compiler: string,
  args: string,
): Promise<CompilerResult> {
  const response = await fetch(
    `https://godbolt.org/api/compiler/${encodeURIComponent(compiler)}/compile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        source,
        compiler,
        lang: "c++",
        options: {
          userArguments: args,
          compilerOptions: { executorRequest: true },
          executeParameters: { args: [], stdin: "" },
          filters: { execute: true },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`Compiler service returned ${response.status}`);
  return response.json() as Promise<CompilerResult>;
}
