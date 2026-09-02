import type { editor as MonacoEditor } from "monaco-editor";
import { appendAnsi } from "../terminal/ansi";
import {
  createCppFallbackEditor,
  type CppFallbackEditor,
} from "../editor/fallback";
import type { CppEditor, EditorStatus } from "../editor/monaco";
import { compileWithCompilerExplorer } from "../compiler-explorer/client";
import {
  createCompilerExplorerUrl,
  resolveCompilerExplorerTarget,
} from "../compiler-explorer/state";
import type {
  CompilationResult,
  CompilerOutputLine,
} from "../compiler-explorer/types";
import type {
  CodeBlock,
  CodeBlocksConfiguration,
  CodeBlockTheme,
  CreateCodeBlockOptions,
} from "./types";
import {
  findCodeBlockElements,
  optionsFromElement,
  readTabs,
} from "./element-options";
import { createCodeBlockView } from "./view";

export type * from "./types";
export type * from "../compiler-explorer/types";
export { compileWithCompilerExplorer } from "../compiler-explorer/client";
export {
  createCompilerExplorerUrl,
  resolveCompilerExplorerTarget,
} from "../compiler-explorer/state";

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
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

export function createCodeBlock(options: CreateCodeBlockOptions): CodeBlock {
  if (!(options.element instanceof HTMLElement)) {
    throw new TypeError("createCodeBlock requires an HTMLElement");
  }

  const root = options.element;
  const tabs = readTabs(root, options.value);
  let activeTab = 0;
  const initialValue = tabs[0].value;
  const {
    tabButtons,
    editorShell,
    fallbackHost,
    monacoHost,
    runButton,
    editorToggle,
    themeToggle,
    compilerLink,
    outputDrawer,
    output,
  } = createCodeBlockView(
    root,
    tabs,
    options.showDebugControls ?? false,
    selectTab,
  );
  const requestedWidth = root.getAttribute("width");
  const requestedHeight = root.getAttribute("height");
  const requestedMinHeight = root.getAttribute("min-height");
  if (requestedWidth) root.style.width = requestedWidth;
  if (requestedHeight)
    root.style.setProperty("--codeblocks-editor-height", requestedHeight);
  if (requestedMinHeight) {
    root.style.setProperty(
      "--codeblocks-editor-min-height",
      requestedMinHeight,
    );
  }
  for (const [name, value] of Object.entries(options.styles ?? {})) {
    root.style.setProperty(
      name.startsWith("--") ? name : `--codeblocks-${name}`,
      value,
    );
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
  let activeEditor: Pick<CppEditor, "getValue" | "setValue" | "focus"> =
    fallback;
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
    const { createCppEditor } = await import("../editor/monaco");
    const created = await createCppEditor({
      element: monacoHost,
      value: fallback?.getValue() ?? initialValue,
      theme: resolvedTheme,
      editorOptions:
        options.editorOptions as MonacoEditor.IStandaloneEditorConstructionOptions,
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

  async function compile(): Promise<CompilationResult> {
    const target = resolveCompilerExplorerTarget(options);
    const result = await compileWithCompilerExplorer({
      ...target,
      source: activeEditor.getValue(),
    });
    options.onResult?.(result);
    return result;
  }

  async function run(): Promise<void> {
    if (disposed || runButton.disabled) return;
    runButton.disabled = true;
    runButton.textContent = "Running...";
    const renderOutput = options.renderOutput !== false;
    outputDrawer.hidden = !renderOutput;
    if (renderOutput) output.textContent = "Compiling...";
    try {
      const result = await compile();
      if (!renderOutput) return;
      const diagnostics = joinLines(result.buildResult?.stderr);
      const stdout = joinLines(result.stdout);
      const stderr = joinLines(result.stderr);
      output.replaceChildren();
      if (result.didExecute) {
        if (!stdout && !stderr)
          output.textContent = "Program completed with no output.";
        else {
          appendAnsi(output, stdout);
          if (stdout && stderr) output.append("\n");
          appendAnsi(output, stderr, { className: "codeblocks-stderr" });
        }
      } else {
        appendAnsi(
          output,
          diagnostics || "Compilation failed without diagnostics.",
        );
      }
    } catch (error) {
      if (renderOutput) output.textContent = `Run failed: ${errorMessage(error)}`;
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
      fallback = createCppFallbackEditor({
        element: fallbackHost,
        value: editor.getValue(),
      });
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
    themeToggle.textContent =
      resolvedTheme === "dark" ? "Use light theme" : "Use dark theme";
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
    const index =
      typeof tab === "number"
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
    getTabs: () =>
      tabs.map((tab, index) => ({
        name: tab.name,
        value: index === activeTab ? activeEditor.getValue() : tab.value,
      })),
    selectTab,
    getCompilerExplorerUrl,
    focus: () => activeEditor.focus(),
    compile,
    run,
    setTheme,
    dispose() {
      if (disposed) return;
      disposed = true;
      runButton.removeEventListener("click", run);
      compilerLink.removeEventListener("click", updateCompilerExplorerLink);
      compilerLink.removeEventListener(
        "pointerdown",
        updateCompilerExplorerLink,
      );
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
  for (const element of findCodeBlockElements(root)) {
    if (element.dataset.codeblocksUpgraded !== undefined) continue;
    element.dataset.codeblocksUpgraded = "";
    const instance = createCodeBlock(optionsFromElement(element, configuration));
    instances.set(element, instance);
  }
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
    console.error(
      `[CodeBlocks] clangd error: ${event.error.message}`,
      event.error,
    );
  }
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function joinLines(lines: CompilerOutputLine[] = []): string {
  return lines.map((line) => line.text).join("\n");
}
