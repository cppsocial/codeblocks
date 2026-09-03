import type { editor as MonacoEditor } from "monaco-editor";
import { appendAnsi } from "../ansi";
import { createSimpleEditor, type SimpleEditor } from "../editor/simple";
import type { CppEditor, EditorStatus } from "../editor/monaco";
import {
  compileWithCompilerExplorer,
  listCompilerExplorerCompilers,
  listCompilerExplorerLanguages,
} from "../compiler-explorer/client";
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
  CodeBlockAction,
  CodeBlockEditorMode,
  CodeBlocksConfiguration,
  CodeBlockOutputView,
  CodeBlockTheme,
  CreateCodeBlockOptions,
} from "./types";
import {
  findCodeBlockElements,
  optionsFromElement,
  readTabs,
  type SourceTab,
} from "./element-options";
import { createCodeBlockView } from "./view";
import { tokenizeAssembly } from "./assembly";
import { beginStartupAttempt, type StartupAttempt } from "../startup-attempt";
import {
  appendTranslationUnits,
  fetchSource,
  parseHighlightedLines,
  parseRunline,
  selectSource,
} from "./source";

export type * from "./types";
export type * from "../compiler-explorer/types";
export {
  compileWithCompilerExplorer,
  listCompilerExplorerCompilers,
  listCompilerExplorerLanguages,
  listCompilerExplorerLibraries,
  listCompilerExplorerTools,
} from "../compiler-explorer/client";
export {
  createCompilerExplorerUrl,
  resolveCompilerExplorerTarget,
} from "../compiler-explorer/state";

const instances = new WeakMap<HTMLElement, CodeBlock>();
let configuration: CodeBlocksConfiguration = {};
let observer: MutationObserver | undefined;
let monacoStartupAttempt: StartupAttempt | undefined;
let monacoStartupFailed = false;

export function configureCodeBlocks(options: CodeBlocksConfiguration): void {
  configuration = { ...configuration, ...options };
}

export function getCodeBlock(element: HTMLElement): CodeBlock | undefined {
  return instances.get(element);
}

export function setCodeBlocksEditorMode(
  mode: CodeBlockEditorMode,
  root: ParentNode = document,
): void {
  for (const element of upgradedElements(root)) {
    instances.get(element)?.setEditorMode(mode);
  }
}

export async function setCodeBlocksTheme(
  theme: CodeBlockTheme,
  root: ParentNode = document,
): Promise<void> {
  await Promise.all(
    upgradedElements(root).map((element) =>
      instances.get(element)?.setTheme(theme),
    ),
  );
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
  if (options.src) tabs[0].src = options.src;
  if (options.range) tabs[0].range = options.range;
  if (options.highlightLines) {
    tabs[0].highlightedLines = parseHighlightedLines(options.highlightLines);
  }
  const fullSources = tabs.map((tab) => tab.value);
  const initialRunlines = fullSources.map((source, index) => {
    const parsed = parseRunline(source);
    fullSources[index] = parsed.source;
    tabs[index].value = selectSource(parsed.source, tabs[index].range);
    return parsed;
  });
  const initialRunline = initialRunlines[0];
  let activeTab = Math.max(
    0,
    tabs.findIndex((tab) => !tab.hidden),
  );
  const inline = options.inline ?? false;
  const readOnly =
    inline || tabs.some((tab) => tab.range) || (options.readOnly ?? false);
  const simple = options.simple ?? false;
  const groupedTabs = Boolean(
    options.multiFile || options.buildSystem || tabs.some((tab) => tab.hidden),
  );
  const outputViews = options.outputViews?.length
    ? options.outputViews
    : [defaultOutputView(options.action)];
  let outputView = outputViews[0];
  const outputPosition = options.outputPosition ?? "below";
  const renderOutput =
    options.renderOutput !== false &&
    options.ui?.output !== false &&
    outputPosition !== "custom";
  const integratedActions = Boolean(options.live) && renderOutput;
  const ui = {
    toolbar: options.ui?.toolbar ?? !inline,
    tabs: options.ui?.tabs ?? !inline,
    runButton: options.ui?.runButton ?? !inline,
    compilerExplorerLink: options.ui?.compilerExplorerLink ?? !inline,
    info: options.ui?.info ?? !inline,
    output: options.ui?.output ?? !inline,
  };
  const editableOptions = readOnly ? false : (options.editableOptions ?? false);
  const view = createCodeBlockView(
    root,
    tabs,
    {
      outputPosition,
      outputViews,
      editableOptions,
      ui,
      activeTab,
      integratedActions,
    },
    selectTab,
  );
  const {
    tabButtons,
    editorShell,
    fallbackHost,
    monacoHost,
    runButton,
    compilerLink,
    infoContent,
    settingFields,
    outputDrawer,
    outputTabs,
    output,
  } = view;

  if (inline) root.classList.add("codeblocks-inline");
  if (readOnly) root.dataset.readonly = "";
  if (simple) root.dataset.simple = "";
  applyDimensions(root, inline, tabs[0].value, options.styles);
  fitFallbackToContent();

  let selection = {
    language: options.language ?? options.compilerExplorer?.language ?? "c++",
    compiler: options.compiler ?? initialRunline.compiler,
    compiler_args:
      options.compiler_args ??
      options.compilerArgs ??
      options.args ??
      initialRunline.compilerArgs,
    run_args: options.run_args ?? options.runArgs ?? "",
    stdin: options.stdin ?? "",
  };
  let compilerDiscovery = 0;
  populateSettings();

  let themeMode = options.theme ?? "auto";
  let resolvedTheme = resolveTheme(themeMode);
  let editorMode: CodeBlockEditorMode = simple ? "simple" : "full";
  root.dataset.theme = resolvedTheme;
  updateActionButton();

  let fallback: SimpleEditor | undefined = createSimpleEditor({
    element: fallbackHost,
    value: tabs[0].value,
    language: selection.language,
    readOnly,
    highlightedLines: displayedHighlightedLines(tabs[0]),
  });
  let editor: CppEditor | undefined;
  let activeEditor: Pick<CppEditor, "getValue" | "setValue" | "focus"> =
    fallback;
  let disposed = false;
  let running = false;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastResult: CompilationResult | undefined;
  let lastStatus: EditorStatus = { type: "monaco-loading" };
  let lastLoggedDownload = -1;
  let visibilityObserver: IntersectionObserver | undefined;
  let revealEditor: (() => void) | undefined;
  const changeListeners = new Set<(value: string) => void>();
  let unsubscribeActive = fallback.onDidChange(notifyChange);
  let unsubscribeSourceHover = () => {};
  updateCompilerExplorerLink();
  updateInfo();
  updateOutputTabs();

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
  outputTabs.forEach((button, name) => {
    button.addEventListener("click", () => setOutputView(name));
  });
  Object.entries(settingFields).forEach(([name, field]) => {
    field?.addEventListener("change", () => updateSetting(name, field.value));
  });

  const media = matchMedia("(prefers-color-scheme: dark)");
  const closePopovers = (event: PointerEvent) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    if (!view.info.contains(target)) view.info.open = false;
    root
      .querySelectorAll<HTMLDetailsElement>(".codeblocks-execution-settings")
      .forEach((details) => {
        if (!details.contains(target)) details.open = false;
      });
  };
  document.addEventListener("pointerdown", closePopovers);
  const systemThemeChanged = () => {
    if (themeMode === "auto") void setTheme("auto");
  };
  media.addEventListener("change", systemThemeChanged);
  const resizeObserver = new ResizeObserver(() => editor?.layout());
  resizeObserver.observe(editorShell);

  const sourceAbort = new AbortController();
  const sourceReady = Promise.all(
    tabs.map(async (tab, index) => {
      if (!tab.src) return;
      const loaded = parseRunline(
        await fetchSource(tab.src, sourceAbort.signal),
      );
      fullSources[index] = loaded.source;
      tab.value = selectSource(loaded.source, tab.range);
      if (index === 0) {
        if (!options.compiler && loaded.compiler)
          selection.compiler = loaded.compiler;
        if (
          options.compiler_args === undefined &&
          options.compilerArgs === undefined &&
          options.args === undefined &&
          loaded.compilerArgs !== undefined
        )
          selection.compiler_args = loaded.compilerArgs;
      }
    }),
  ).then(() => {
    if (disposed) return;
    activeEditor.setValue(tabs[activeTab].value);
    if (inline)
      applyDimensions(root, true, tabs[activeTab].value, options.styles);
    fallback?.setHighlightedLines(displayedHighlightedLines(tabs[activeTab]));
    editor?.setHighlightedLines(displayedHighlightedLines(tabs[activeTab]));
    if (editor) fitEditorToContent();
    else fitFallbackToContent();
    editor?.layout();
    populateSettings();
    updateCompilerExplorerLink();
    updateInfo();
  });
  void sourceReady.catch((error: unknown) => {
    if (!disposed)
      fallback?.setValue(`Unable to load source: ${errorMessage(error)}`);
  });

  const monacoEditorReady = simple ? undefined : upgradeEditor();
  const editorReady: Promise<CppEditor | SimpleEditor> = monacoEditorReady
    ? monacoEditorReady.catch(fallBackFromMonaco)
    : Promise.resolve(fallback);
  const monacoReady: Promise<unknown> = simple
    ? Promise.resolve(undefined)
    : monacoEditorReady!.then((created) => created.getMonacoEditor());
  if (simple) resolveClangd();
  void monacoReady.catch(() => {});

  function fallBackFromMonaco(error: unknown): SimpleEditor {
    monacoStartupFailed = true;
    if (options.showDebugControls)
      console.error("[CodeBlocks] Monaco failed; using simple editor", error);
    rejectClangd(error);

    let value = tabs[activeTab].value;
    if (editor) {
      try {
        value = editor.getValue();
      } catch {
        // A failed Monaco instance may no longer expose its model.
      }
      editor.dispose();
      editor = undefined;
    }
    monacoHost.hidden = true;
    delete monacoHost.dataset.ready;
    editorMode = "simple";
    if (!fallback) {
      fallback = createSimpleEditor({
        element: fallbackHost,
        value,
        language: selection.language,
        readOnly,
        highlightedLines: displayedHighlightedLines(tabs[activeTab]),
      });
      editorShell.prepend(fallbackHost);
    } else {
      fallback.setValue(value);
    }
    activeEditor = fallback;
    subscribeToActive(fallback);
    fitFallbackToContent();
    return fallback;
  }

  async function upgradeEditor(): Promise<CppEditor> {
    if (options.deferMonaco !== false) await waitUntilNearViewport();
    if (groupedTabs) await sourceReady;
    if (disposed)
      throw new Error("Code block was disposed while the editor was loading");
    if (monacoStartupFailed) {
      throw new Error("Monaco was disabled after a previous startup failure");
    }
    const startupAttempt =
      monacoStartupAttempt ??
      (monacoStartupAttempt = beginStartupAttempt("monaco", 1));
    if (!startupAttempt.allowed) {
      throw new Error(
        "Monaco was disabled after its previous startup was interrupted",
      );
    }
    const { createCppEditor } = await import("../editor/monaco");
    const inlineOptions: MonacoEditor.IStandaloneEditorConstructionOptions =
      inline
        ? {
            lineNumbers: "off",
            lineDecorationsWidth: 0,
            overviewRulerLanes: 0,
            renderLineHighlight: "none",
            padding: { top: 0, bottom: 0 },
            scrollbar: { vertical: "hidden", horizontal: "hidden" },
            scrollBeyondLastColumn: 0,
            hideCursorInOverviewRuler: true,
            fontSize: inlineMetrics(root).fontSize,
            lineHeight: inlineMetrics(root).lineHeight,
          }
        : {};
    const created = await createCppEditor({
      element: monacoHost,
      value: fallback?.getValue() ?? tabs[0].value,
      language: selection.language,
      filename: tabs[activeTab].name,
      readOnly,
      theme: resolvedTheme,
      editorOptions: {
        ...(readOnly ? { domReadOnly: true } : {}),
        ...inlineOptions,
        ...(options.editorOptions as MonacoEditor.IStandaloneEditorConstructionOptions),
      },
      onStatus: reportStatus,
      workspaceFiles: groupedTabs
        ? tabs.map((tab, index) => ({
            filename: compilerFilename(
              tab.name,
              index === primarySourceIndex() && !options.buildSystem,
            ),
            contents: fullSources[index],
          }))
        : undefined,
    });
    if (disposed) {
      created.dispose();
      throw new Error("Code block was disposed while the editor was loading");
    }
    editor = created;
    unsubscribeSourceHover = created.onDidHoverSourceLine((line) => {
      const sourceLine = line
        ? line + ((tabs[activeTab].range?.startLine ?? 1) - 1)
        : undefined;
      output
        .querySelectorAll<HTMLElement>("[data-source-line]")
        .forEach((row) => {
          row.classList.toggle(
            "codeblocks-assembly-source-hover",
            Number(row.dataset.sourceLine) === sourceLine &&
              (!row.dataset.sourceFile ||
                sourceFileMatches(
                  row.dataset.sourceFile,
                  tabs[activeTab].name,
                )),
          );
        });
    });
    created.setValue(fallback?.getValue() ?? created.getValue());
    await created.setTheme(resolvedTheme);
    created.setHighlightedLines(displayedHighlightedLines(tabs[activeTab]));
    if (!inline) monacoHost.style.background = themeBackground(resolvedTheme);
    created.layout();
    await afterPaint();
    monacoHost.dataset.ready = "";
    await afterPaint();
    if (editorMode === "full") {
      removeFallback();
      activeEditor = created;
      subscribeToActive(created);
    } else {
      monacoHost.hidden = true;
    }
    fitEditorToContent();
    created.clangdReady.then(resolveClangd, rejectClangd);
    startupAttempt.succeeded();
    if (monacoStartupAttempt === startupAttempt)
      monacoStartupAttempt = undefined;
    return created;
  }

  function waitUntilNearViewport(): Promise<void> {
    if (!("IntersectionObserver" in globalThis)) return Promise.resolve();
    const bounds = root.getBoundingClientRect();
    if (bounds.bottom >= -800 && bounds.top <= innerHeight + 800)
      return Promise.resolve();
    return new Promise((resolve) => {
      revealEditor = resolve;
      visibilityObserver = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          visibilityObserver?.disconnect();
          visibilityObserver = undefined;
          revealEditor = undefined;
          resolve();
        },
        { rootMargin: "800px 0px" },
      );
      visibilityObserver.observe(root);
    });
  }

  function reportStatus(event: EditorStatus): void {
    lastStatus = event;
    updateInfo();
    if (options.showDebugControls) {
      if (event.type !== "clangd-downloading") logStatus(event);
      else {
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
    await sourceReady;
    const buildSystem = options.buildSystem;
    const primaryIndex = primarySourceIndex();
    if (buildSystem && primaryIndex < 0) {
      throw new Error("A CMake code block requires a CMakeLists.txt tab");
    }
    const target = resolveCompilerExplorerTarget(
      projectSelection(primaryIndex),
    );
    const source = sourceForCompilation(primaryIndex);
    const result = await compileWithCompilerExplorer({
      ...target,
      source,
      files: [
        ...(options.files ?? []),
        ...tabs.flatMap((tab, index) =>
          !groupedTabs || index === primaryIndex
            ? []
            : [{ filename: tab.name, contents: fullSources[index] }],
        ),
      ],
      buildSystem,
      execute: outputViews.includes("execution"),
    });
    lastResult = result;
    updateInfo();
    options.onResult?.(result);
    return result;
  }

  async function run(): Promise<void> {
    if (disposed || running) return;
    running = true;
    runButton.disabled = true;
    const idleLabel = "Run";
    if (integratedActions) {
      runButton.setAttribute("aria-label", "Running");
      runButton.title = "Running";
    } else {
      runButton.textContent = outputViews.includes("execution")
        ? "Running…"
        : "Compiling…";
    }
    if (renderOutput) {
      outputDrawer.hidden = false;
      output.textContent = "Compiling…";
    }
    try {
      const result = await compile();
      if (
        outputView === "compiler" &&
        outputViews.length > 1 &&
        !hasCompilerOutput(result)
      ) {
        outputView =
          outputViews.find((view) => view !== "compiler") ?? outputView;
      }
      if (renderOutput) renderSelectedOutput(result);
    } catch (error) {
      if (renderOutput)
        output.textContent = `${idleLabel} failed: ${errorMessage(error)}`;
    } finally {
      running = false;
      runButton.disabled = false;
      if (integratedActions) {
        runButton.setAttribute("aria-label", "Run again");
        runButton.title = "Run again";
      } else runButton.textContent = idleLabel;
    }
  }

  function renderSelectedOutput(result = lastResult): void {
    if (!renderOutput) return;
    outputDrawer.hidden = false;
    output.replaceChildren();
    updateOutputTabs();
    if (!result) {
      output.textContent = "No result yet.";
      return;
    }
    if (outputView === "assembly") {
      const code = document.createElement("code");
      const assembly = result.asm ?? [];
      if (!assembly.length) code.textContent = "No assembly was returned.";
      else {
        for (const line of assembly) {
          const row = document.createElement("span");
          row.className = "codeblocks-assembly-line";
          for (const token of tokenizeAssembly(line.text)) {
            if (token.kind === "plain") row.append(token.text);
            else {
              const span = document.createElement("span");
              span.className = `codeblocks-assembly-token-${token.kind}`;
              span.textContent = token.text;
              row.append(span);
            }
          }
          if (line.source?.line) {
            row.dataset.sourceLine = String(line.source.line);
            if (line.source.file) row.dataset.sourceFile = line.source.file;
            row.addEventListener("pointerenter", () => {
              const sameFile =
                !line.source!.file ||
                sourceFileMatches(line.source!.file, tabs[activeTab].name);
              const displayLine =
                line.source!.line -
                ((tabs[activeTab].range?.startLine ?? 1) - 1);
              editor?.highlightSourceLine(
                sameFile && displayLine > 0 ? displayLine : undefined,
              );
            });
            row.addEventListener("pointerleave", () =>
              editor?.highlightSourceLine(),
            );
          }
          code.append(row);
        }
      }
      output.append(code);
      return;
    }
    if (outputView === "compiler") {
      const stdout = joinLines(result.buildResult?.stdout ?? result.stdout);
      const stderr = joinLines(result.buildResult?.stderr ?? result.stderr);
      appendCombinedOutput(
        stdout,
        stderr,
        "Compilation completed with no output.",
      );
      return;
    }
    if (outputView.startsWith("tool:")) {
      output.textContent = toolOutput(result, outputView.slice(5));
      return;
    }
    const stdout = joinLines(result.stdout);
    const stderr = joinLines(result.stderr);
    if (result.didExecute) {
      appendCombinedOutput(stdout, stderr, "Program completed with no output.");
      const exitCode = result.code ?? 0;
      const status = document.createElement("span");
      status.className = `codeblocks-exit-status${exitCode === 0 ? "" : " codeblocks-exit-status-error"}`;
      status.textContent = `\n\nProcess exited with code ${exitCode}`;
      output.append(status);
    } else {
      appendAnsi(
        output,
        joinLines(result.buildResult?.stderr) ||
          "The program was not executed.",
      );
    }
  }

  function appendCombinedOutput(
    stdout: string,
    stderr: string,
    empty: string,
  ): void {
    if (!stdout && !stderr) output.textContent = empty;
    else {
      appendAnsi(output, stdout);
      if (stdout && stderr) output.append("\n");
      appendAnsi(output, stderr, { className: "codeblocks-stderr" });
    }
  }

  function setOutputView(viewName: CodeBlockOutputView): void {
    outputView = viewName;
    const field = settingFields.output as HTMLSelectElement | undefined;
    if (
      field &&
      Array.from(field.options).some((option) => option.value === viewName)
    ) {
      field.value = viewName;
    }
    renderSelectedOutput();
  }

  function updateOutputTabs(): void {
    outputTabs.forEach((button, name) => {
      if (name === "compiler" && lastResult && outputTabs.size > 1) {
        button.hidden = !hasCompilerOutput(lastResult);
      }
      const selected = name === outputView;
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function setEditorMode(mode: CodeBlockEditorMode): void {
    editorMode = mode;
    if (!editor) return;
    if (mode === "full" && fallback) {
      editor.setValue(fallback.getValue());
      removeFallback();
      monacoHost.hidden = false;
      monacoHost.dataset.ready = "";
      editor.layout();
      activeEditor = editor;
      subscribeToActive(editor);
    } else if (mode === "simple" && !fallback) {
      monacoHost.hidden = true;
      delete monacoHost.dataset.ready;
      fallback = createSimpleEditor({
        element: fallbackHost,
        value: editor.getValue(),
        language: selection.language,
        readOnly,
        highlightedLines: displayedHighlightedLines(tabs[activeTab]),
      });
      editorShell.prepend(fallbackHost);
      activeEditor = fallback;
      subscribeToActive(fallback);
    }
  }

  async function setTheme(theme: CodeBlockTheme): Promise<void> {
    themeMode = theme;
    resolvedTheme = resolveTheme(theme);
    root.dataset.theme = resolvedTheme;
    if (!inline) monacoHost.style.background = themeBackground(resolvedTheme);
    await editor?.setTheme(resolvedTheme);
    editor?.setHighlightedLines(displayedHighlightedLines(tabs[activeTab]));
  }

  function updateActionButton(): void {
    if (!integratedActions) runButton.textContent = "Run";
  }

  function removeFallback(): void {
    if (!fallback) return;
    fallback.dispose();
    fallback = undefined;
    fallbackHost.remove();
  }

  function subscribeToActive(source: CppEditor | SimpleEditor): void {
    unsubscribeActive();
    unsubscribeActive = source.onDidChange(notifyChange);
  }

  function notifyChange(value: string): void {
    tabs[activeTab].value = value;
    if (!tabs[activeTab].range) fullSources[activeTab] = value;
    changeListeners.forEach((listener) => listener(value));
    if (editor) fitEditorToContent();
    else fitFallbackToContent();
    if (options.live !== undefined && options.live !== false) {
      clearTimeout(liveTimer);
      visibilityObserver?.disconnect();
      revealEditor?.();
      liveTimer = setTimeout(
        () => void run(),
        typeof options.live === "number" ? options.live : 500,
      );
    }
  }

  function fitFallbackToContent(): void {
    if (!options.fit && !inline) return;
    const mode = options.fit === true ? "both" : options.fit || "both";
    const metrics = inlineMetrics(root);
    const value = tabs[activeTab].value;
    if (mode === "both" || mode === "height") {
      const padding = inline ? 0 : 32;
      root.style.setProperty(
        "--codeblocks-editor-height",
        `${value.split("\n").length * metrics.lineHeight + padding}px`,
      );
    }
    if (mode === "both" || mode === "width") {
      const longest = Math.max(...value.split("\n").map((line) => line.length));
      root.style.width = `min(100%, ${longest + (inline ? 1 : 8)}ch)`;
    }
  }

  function fitEditorToContent(): void {
    if (!editor || !options.fit) return;
    const mode = options.fit === true ? "both" : options.fit || "both";
    const monaco = editor.getMonacoEditor();
    if (mode === "both" || mode === "height") {
      root.style.setProperty(
        "--codeblocks-editor-height",
        `${monaco.getContentHeight()}px`,
      );
    }
    if (mode === "both" || mode === "width") {
      root.style.width = `min(100%, ${monaco.getContentWidth() + 2}px)`;
    }
    editor.layout();
  }

  function currentSelection() {
    return { ...options, ...selection };
  }

  function projectSelection(primaryIndex: number) {
    const current = currentSelection();
    if (!groupedTabs || options.buildSystem) return current;
    const filenames = [
      ...(options.files ?? []).map((file) => file.filename),
      ...tabs.flatMap((tab, index) =>
        index === primaryIndex ? [] : [tab.name],
      ),
    ];
    const target = resolveCompilerExplorerTarget(current);
    return {
      ...current,
      compiler_args: appendTranslationUnits(target.options, filenames),
    };
  }

  function getCompilerExplorerUrl(): string {
    if (options.compilerExplorerLinkUrl) return options.compilerExplorerLinkUrl;
    const primaryIndex = primarySourceIndex();
    if (primaryIndex < 0) {
      throw new Error("A CMake code block requires a CMakeLists.txt tab");
    }
    return createCompilerExplorerUrl(
      sourceForCompilation(primaryIndex),
      compilerFilename(tabs[primaryIndex].name, !options.buildSystem),
      {
        ...projectSelection(primaryIndex),
        files: [
          ...(options.files ?? []),
          ...tabs.flatMap((tab, index) =>
            !groupedTabs || index === primaryIndex
              ? []
              : [{ filename: tab.name, contents: fullSources[index] }],
          ),
        ],
        execute: outputViews.includes("execution"),
      },
    );
  }

  function primarySourceIndex(): number {
    if (options.buildSystem) {
      return tabs.findIndex(
        (tab) => tab.name.toLowerCase() === "cmakelists.txt",
      );
    }
    if (groupedTabs) {
      const example = tabs.findIndex(
        (tab) => tab.name.toLowerCase() === "example.cpp",
      );
      return example >= 0 ? example : 0;
    }
    return activeTab;
  }

  function updateCompilerExplorerLink(): void {
    try {
      compilerLink.href = getCompilerExplorerUrl();
      compilerLink.removeAttribute("aria-disabled");
      if (integratedActions) compilerLink.title = "Open in Compiler Explorer";
      else compilerLink.removeAttribute("title");
    } catch (error) {
      compilerLink.removeAttribute("href");
      compilerLink.setAttribute("aria-disabled", "true");
      compilerLink.title = errorMessage(error);
    }
  }

  function selectTab(tab: string | number): void {
    const index =
      typeof tab === "number"
        ? tab
        : tabs.findIndex((candidate) => candidate.name === tab);
    if (index < 0 || index >= tabs.length || index === activeTab) return;
    tabs[activeTab].value = activeEditor.getValue();
    if (!tabs[activeTab].range) fullSources[activeTab] = tabs[activeTab].value;
    activeTab = index;
    activeEditor.setValue(tabs[index].value);
    fallback?.setHighlightedLines(displayedHighlightedLines(tabs[index]));
    editor?.setHighlightedLines(displayedHighlightedLines(tabs[index]));
    tabButtons.forEach((tabButton, buttonIndex) => {
      const selected = buttonIndex === index;
      tabButton.setAttribute("aria-selected", selected ? "true" : "false");
      tabButton.tabIndex = selected ? 0 : -1;
    });
    updateCompilerExplorerLink();
    updateInfo();
    if (!groupedTabs) {
      lastResult = undefined;
      output.replaceChildren();
      outputDrawer.hidden = true;
    } else if (lastResult) {
      renderSelectedOutput(lastResult);
    }
    activeEditor.focus();
  }

  function sourceForCompilation(index: number): string {
    if (!tabs[index].range)
      return index === activeTab ? activeEditor.getValue() : fullSources[index];
    // Ranged snippets intentionally compile the complete source document. They are
    // presentation windows and are normally read-only.
    return fullSources[index];
  }

  function populateSettings(): void {
    const target = resolveCompilerExplorerTarget(currentSelection());
    const values: Record<string, string> = {
      language: selection.language,
      compiler: target.compiler,
      compiler_args: target.options,
      run_args: selection.run_args,
      stdin: selection.stdin,
      output: outputView,
    };
    Object.entries(settingFields).forEach(([name, field]) => {
      if (!field) return;
      if (field instanceof HTMLSelectElement && !field.options.length) {
        appendSelectOption(
          field,
          values[name] ?? "",
          values[name] ?? "Loading…",
        );
      }
      field.value = values[name] ?? "";
    });
    void populateLanguageChoices();
    void populateCompilerChoices();
  }

  async function populateLanguageChoices(): Promise<void> {
    const field = settingFields.language;
    if (!(field instanceof HTMLSelectElement)) return;
    try {
      const target = resolveCompilerExplorerTarget(currentSelection());
      const languages = await listCompilerExplorerLanguages(target.baseUrl);
      if (disposed) return;
      replaceSelectOptions(
        field,
        languages.map((language) => ({
          value: language.id,
          label: language.name,
        })),
        selection.language,
      );
    } catch {
      replaceSelectOptions(
        field,
        [{ value: selection.language, label: selection.language }],
        selection.language,
      );
    }
  }

  async function populateCompilerChoices(): Promise<void> {
    const field = settingFields.compiler;
    if (!(field instanceof HTMLSelectElement)) return;
    const request = ++compilerDiscovery;
    const requestedLanguage = selection.language;
    field.disabled = true;
    try {
      const target = resolveCompilerExplorerTarget(currentSelection());
      const compilers = await listCompilerExplorerCompilers(
        requestedLanguage,
        target.baseUrl,
      );
      if (
        disposed ||
        request !== compilerDiscovery ||
        requestedLanguage !== selection.language
      )
        return;
      const preferred = compilers.some(
        (compiler) => compiler.id === selection.compiler,
      )
        ? selection.compiler
        : compilers.some((compiler) => compiler.id === target.compiler)
          ? target.compiler
          : compilers[0]?.id;
      selection.compiler = preferred;
      replaceSelectOptions(
        field,
        compilers.map((compiler) => ({
          value: compiler.id,
          label: compiler.name,
        })),
        preferred ?? "",
      );
      updateCompilerExplorerLink();
      updateInfo();
    } catch {
      const target = resolveCompilerExplorerTarget(currentSelection());
      replaceSelectOptions(
        field,
        target.compiler
          ? [{ value: target.compiler, label: target.compiler }]
          : [],
        target.compiler,
      );
    } finally {
      if (request === compilerDiscovery) field.disabled = false;
    }
  }

  function updateSetting(name: string, value: string): void {
    if (name === "language") {
      selection.language = value;
      selection.compiler = undefined;
      selection.compiler_args = undefined;
      const target = resolveCompilerExplorerTarget(currentSelection());
      selection.compiler = target.compiler || undefined;
      selection.compiler_args = target.options;
      const compilerArgs = settingFields.compiler_args;
      if (compilerArgs) compilerArgs.value = target.options;
      fallback?.setLanguage(value);
      editor?.setLanguage(value);
      void populateCompilerChoices();
    } else if (name === "compiler") selection.compiler = value || undefined;
    else if (name === "compiler_args") selection.compiler_args = value;
    else if (name === "run_args") selection.run_args = value;
    else if (name === "stdin") selection.stdin = value;
    else if (name === "output") {
      setOutputView(value as CodeBlockOutputView);
    }
    updateCompilerExplorerLink();
    updateInfo();
  }

  function updateInfo(): void {
    const target = resolveCompilerExplorerTarget(currentSelection());
    const heading = document.createElement("strong");
    heading.textContent = options.info?.name ?? "Codeblocks";
    const description = document.createElement("p");
    description.textContent =
      options.info?.description ??
      "An embeddable editor with in-browser clangd code help and compilation powered by Compiler Explorer.";
    const api = document.createElement("p");
    const godbolt = document.createElement("a");
    godbolt.href = "https://godbolt.org/";
    godbolt.target = "_blank";
    godbolt.rel = "noopener";
    godbolt.textContent = "Compiler Explorer (Godbolt)";
    api.append("Compilation API: ", godbolt);
    const details = document.createElement("dl");
    addInfo(details, "Language", target.language);
    addInfo(details, "Compiler", target.compiler || "Required");
    addInfo(details, "Compiler args", target.options || "None");
    if (target.run_args) addInfo(details, "Run args", target.run_args);
    if (target.stdin) addInfo(details, "Standard input", "Configured");
    if (
      !simple &&
      (lastStatus.type === "clangd-ready" || lastStatus.type === "clangd-error")
    ) {
      addInfo(details, "clangd", statusLabel(lastStatus));
    }
    if (lastResult) addInfo(details, "Last result", resultLabel(lastResult));
    const source = document.createElement("a");
    source.href =
      options.info?.sourceUrl ?? "https://github.com/cppsocial/codeblocks";
    source.target = "_blank";
    source.rel = "noopener";
    source.textContent = "Source code";
    infoContent.replaceChildren(heading, description, api, details, source);
  }

  const instance: CodeBlock = {
    getValue: () => activeEditor.getValue(),
    setValue(value) {
      tabs[activeTab].value = value;
      activeEditor.setValue(value);
      fallback?.setHighlightedLines(displayedHighlightedLines(tabs[activeTab]));
      editor?.setHighlightedLines(displayedHighlightedLines(tabs[activeTab]));
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
    setOutputView,
    setEditorMode,
    setTheme,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(liveTimer);
      sourceAbort.abort();
      visibilityObserver?.disconnect();
      revealEditor?.();
      runButton.removeEventListener("click", run);
      compilerLink.removeEventListener("click", updateCompilerExplorerLink);
      compilerLink.removeEventListener(
        "pointerdown",
        updateCompilerExplorerLink,
      );
      compilerLink.removeEventListener("focus", updateCompilerExplorerLink);
      media.removeEventListener("change", systemThemeChanged);
      document.removeEventListener("pointerdown", closePopovers);
      resizeObserver.disconnect();
      unsubscribeActive();
      unsubscribeSourceHover();
      changeListeners.clear();
      fallback?.dispose();
      editor?.dispose();
      root.replaceChildren();
      root.classList.remove("codeblocks-root", "codeblocks-inline");
      delete root.dataset.theme;
      delete root.dataset.readonly;
      delete root.dataset.simple;
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
    sourceReady,
  };
  instances.set(root, instance);
  if (options.live !== undefined && options.live !== false) {
    queueMicrotask(() => void run());
  }
  return instance;
}

function displayedHighlightedLines(tab: SourceTab): number[] {
  const lines = tab.highlightedLines ?? [];
  if (!tab.range) return lines;
  const start = tab.range.startLine ?? 1;
  const end =
    tab.range.endLine ?? tab.range.startLine ?? Number.POSITIVE_INFINITY;
  return lines
    .filter((line) => line >= start && line <= end)
    .map((line) => line - start + 1);
}

function compilerFilename(filename: string, primary: boolean): string {
  if (!primary) return filename;
  const extension = filename.match(/\.[a-z0-9+]+$/i)?.[0];
  return extension ? `example${extension}` : "example.cpp";
}

function appendSelectOption(
  select: HTMLSelectElement,
  value: string,
  label: string,
): void {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function replaceSelectOptions(
  select: HTMLSelectElement,
  choices: Array<{ value: string; label: string }>,
  selected: string,
): void {
  if (selected && !choices.some((choice) => choice.value === selected)) {
    choices = [{ value: selected, label: selected }, ...choices];
  }
  select.replaceChildren();
  for (const choice of choices) {
    appendSelectOption(select, choice.value, choice.label);
  }
  select.value = selected;
}

function sourceFileMatches(sourceFile: string, tabName: string): boolean {
  return sourceFile === tabName || sourceFile.endsWith(`/${tabName}`);
}

function upgradedElements(root: ParentNode): HTMLElement[] {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>(
      "codeblock[data-codeblocks-upgraded], cb[data-codeblocks-upgraded]",
    ),
  );
  if (
    root instanceof HTMLElement &&
    root.matches(
      "codeblock[data-codeblocks-upgraded], cb[data-codeblocks-upgraded]",
    )
  ) {
    elements.unshift(root);
  }
  return elements;
}

function upgradeWithin(root: ParentNode): void {
  for (const element of findCodeBlockElements(root)) {
    if (element.dataset.codeblocksUpgraded !== undefined) continue;
    element.dataset.codeblocksUpgraded = "";
    instances.set(
      element,
      createCodeBlock(optionsFromElement(element, configuration)),
    );
  }
}

function applyDimensions(
  root: HTMLElement,
  inline: boolean,
  source: string,
  styles: Record<string, string> | undefined,
): void {
  const requestedWidth = root.getAttribute("width");
  const requestedHeight = root.getAttribute("height");
  const requestedMinHeight = root.getAttribute("min-height");
  if (requestedWidth) root.style.width = requestedWidth;
  if (requestedHeight)
    root.style.setProperty("--codeblocks-editor-height", requestedHeight);
  else if (inline) {
    const metrics = inlineMetrics(root);
    const lines = source.split("\n").length;
    const longestLine = Math.max(
      ...source.split("\n").map((line) => line.length),
    );
    root.style.setProperty(
      "--codeblocks-editor-height",
      `${Math.max(metrics.lineHeight, lines * metrics.lineHeight)}px`,
    );
    root.style.setProperty(
      "--codeblocks-inline-width",
      `${Math.max(4, longestLine + 4)}ch`,
    );
  }
  if (requestedMinHeight)
    root.style.setProperty(
      "--codeblocks-editor-min-height",
      requestedMinHeight,
    );
  for (const [name, value] of Object.entries(styles ?? {})) {
    root.style.setProperty(
      name.startsWith("--") ? name : `--codeblocks-${name}`,
      value,
    );
  }
}

function inlineMetrics(root: HTMLElement): {
  fontSize: number;
  lineHeight: number;
} {
  const style = getComputedStyle(root);
  const fontSize = Number.parseFloat(style.fontSize) || 14;
  const parsedLineHeight = Number.parseFloat(style.lineHeight);
  return {
    fontSize,
    lineHeight: Number.isFinite(parsedLineHeight)
      ? parsedLineHeight
      : fontSize * 1.2,
  };
}

function defaultOutputView(
  action: CodeBlockAction | undefined,
): CodeBlockOutputView {
  if (action === "disassemble") return "assembly";
  return action === "compile" ? "compiler" : "execution";
}

function toolOutput(result: CompilationResult, name: string): string {
  const tools = result.tools ?? [];
  const tool = tools.find((value) => {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return record.id === name || record.name === name || record.tool === name;
  });
  if (!tool) return `No output was returned for tool “${name}”.`;
  if (typeof tool === "string") return tool;
  const record = tool as Record<string, unknown>;
  for (const key of ["stdout", "stderr", "output", "result"]) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      const lines = value as Array<{ text?: unknown } | unknown>;
      return lines
        .map((line) =>
          line && typeof line === "object" && "text" in line
            ? String((line as { text: unknown }).text)
            : String(line),
        )
        .join("\n");
    }
  }
  return JSON.stringify(tool, null, 2);
}

function addInfo(list: HTMLDListElement, term: string, value: string): void {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  list.append(dt, dd);
}

function statusLabel(status: EditorStatus): string {
  return status.type.replaceAll("-", " ");
}

function resultLabel(result: CompilationResult): string {
  if (result.didExecute)
    return result.code === 0 || result.code === undefined
      ? "Executed"
      : `Exited with ${result.code}`;
  return result.code === 0 || result.buildResult?.code === 0
    ? "Compiled"
    : "Compilation failed";
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
  if (event.type === "monaco-loading")
    console.info("[CodeBlocks] Monaco loading");
  else if (event.type === "monaco-ready")
    console.info("[CodeBlocks] Monaco loaded");
  else if (event.type === "clangd-downloading") {
    const progress = event.total
      ? `${formatMegabytes(event.loaded)} MB / ${formatMegabytes(event.total)} MB`
      : `${formatMegabytes(event.loaded)} MB downloaded`;
    console.info(`[CodeBlocks] clangd downloading: ${progress}`);
  } else if (event.type === "clangd-starting")
    console.info("[CodeBlocks] clangd starting");
  else if (event.type === "clangd-loaded")
    console.info("[CodeBlocks] clangd loaded");
  else if (event.type === "clangd-ready")
    console.info("[CodeBlocks] clangd activated");
  else if (event.type === "clangd-error")
    console.error(
      `[CodeBlocks] clangd error: ${event.error.message}`,
      event.error,
    );
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function joinLines(lines: CompilerOutputLine[] = []): string {
  return lines.map((line) => line.text).join("\n");
}

function hasCompilerOutput(result: CompilationResult): boolean {
  const text =
    joinLines(result.buildResult?.stdout ?? result.stdout) +
    joinLines(result.buildResult?.stderr ?? result.stderr);
  return Boolean(text) || (result.buildResult?.code ?? result.code ?? 0) !== 0;
}
