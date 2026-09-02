import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import "@codingame/monaco-vscode-theme-defaults-default-extension";
import "@codingame/monaco-vscode-cpp-default-extension";
import { Uri } from "vscode";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from "vscode-languageclient/browser";
import {
  LanguageClientConfig,
  MonacoEditorLanguageClientWrapper,
  UserConfig,
} from "monaco-editor-wrapper";
import editorWorkerUrl from "monaco-editor/esm/vs/editor/editor.worker?worker&url";
import { editor as monacoEditorApi, Range } from "monaco-editor";
import type { editor as MonacoEditor } from "monaco-editor";
import { FILE_PATH, LANGUAGE_ID, WORKSPACE_PATH } from "../../clangd/config";
import { EditorStatus, startClangd, StatusReporter } from "../../clangd/client";
import { createRemoteModuleWorker } from "../../clangd/worker-bootstrap";
import "./runtime.css";

export type { EditorStatus } from "../../clangd/client";
export { ansiToFragment, appendAnsi, stripAnsi } from "../../ansi";

export interface CreateCppEditorOptions {
  element: HTMLElement;
  value?: string;
  language?: string;
  filename?: string;
  readOnly?: boolean;
  theme?: "light" | "dark";
  editorOptions?: MonacoEditor.IStandaloneEditorConstructionOptions;
  onStatus?: (status: EditorStatus) => void;
  workspaceFiles?: Array<{ filename: string; contents: string }>;
}

export interface CppEditor {
  getValue(): string;
  setValue(value: string): void;
  setLanguage(language: string): void;
  focus(): void;
  layout(): void;
  highlightSourceLine(line?: number): void;
  setHighlightedLines(lines: number[]): void;
  onDidHoverSourceLine(callback: (line?: number) => void): () => void;
  getMonacoEditor(): MonacoEditor.IStandaloneCodeEditor;
  setTheme(theme: "light" | "dark"): Promise<void>;
  dispose(): void;
  onDidChange(callback: (value: string) => void): () => void;
  clangdReady: Promise<void>;
}

interface SharedRuntime {
  wrapper: MonacoEditorLanguageClientWrapper;
  primaryEditor: MonacoEditor.IStandaloneCodeEditor;
  primaryStaging: HTMLElement;
  clangdReady: Promise<void>;
  reporters: Set<StatusReporter>;
  lastClangdStatus?: EditorStatus;
  setWorkspaceFiles(files: Array<{ filename: string; contents: string }>): void;
}

interface SharedRuntimeSlot {
  promise: Promise<SharedRuntime>;
  reporters: Set<StatusReporter>;
}

const noop: StatusReporter = () => {};
let sharedSlot: SharedRuntimeSlot | undefined;
let editorSequence = 0;

export async function createCppEditor(
  options: CreateCppEditorOptions,
): Promise<CppEditor> {
  if (!(options.element instanceof HTMLElement)) {
    throw new TypeError(
      "createCppEditor requires an HTMLElement in options.element",
    );
  }

  const report = options.onStatus ?? noop;
  report({ type: "monaco-loading" });
  const isPrimary = !sharedSlot;

  if (!sharedSlot) {
    const reporters = new Set<StatusReporter>([report]);
    const slot: SharedRuntimeSlot = {
      reporters,
      promise: Promise.resolve(undefined as never),
    };
    slot.promise = initializeSharedRuntime(options, reporters).catch(
      (error) => {
        if (sharedSlot === slot) sharedSlot = undefined;
        throw error;
      },
    );
    sharedSlot = slot;
  } else {
    sharedSlot.reporters.add(report);
  }

  let shared: SharedRuntime;
  try {
    shared = await sharedSlot.promise;
  } catch (error) {
    sharedSlot?.reporters.delete(report);
    throw error;
  }

  if (shared.lastClangdStatus && !isPrimary) report(shared.lastClangdStatus);
  shared.setWorkspaceFiles(options.workspaceFiles ?? []);

  const staging = isPrimary
    ? shared.primaryStaging
    : createStaging(options.element, options.theme ?? "dark");
  let editor: MonacoEditor.IStandaloneCodeEditor;
  let model: MonacoEditor.ITextModel | undefined;

  if (isPrimary) {
    editor = shared.primaryEditor;
    const primaryModel = editor.getModel();
    if (primaryModel) {
      monacoEditorApi.setModelLanguage(
        primaryModel,
        monacoLanguage(options.language),
      );
    }
  } else {
    model = monacoEditorApi.createModel(
      options.value ?? "",
      monacoLanguage(options.language),
      Uri.file(modelPath(options.filename, ++editorSequence)),
    );
    editor = monacoEditorApi.create(staging, {
      ...defaultEditorOptions(options.theme ?? "dark"),
      ...options.editorOptions,
      scrollbar: {
        ...defaultEditorOptions(options.theme ?? "dark").scrollbar,
        ...options.editorOptions?.scrollbar,
        alwaysConsumeMouseWheel: false,
      },
      readOnly: options.readOnly ?? options.editorOptions?.readOnly,
      model,
      theme: options.theme === "light" ? "vs" : "vs-dark",
    });
    staging.style.visibility = "visible";
  }

  report({ type: "monaco-ready" });
  const sourceHighlight = editor.createDecorationsCollection();
  const persistentHighlights = editor.createDecorationsCollection();
  let disposed = false;
  return {
    getValue: () => editor.getValue(),
    setValue: (value) => editor.setValue(value),
    setLanguage(language) {
      const currentModel = editor.getModel();
      if (currentModel)
        monacoEditorApi.setModelLanguage(
          currentModel,
          monacoLanguage(language),
        );
    },
    focus: () => editor.focus(),
    layout: () => editor.layout(),
    highlightSourceLine(line) {
      const currentModel = editor.getModel();
      const lineCount = currentModel?.getLineCount() ?? 0;
      sourceHighlight.set(
        line && line >= 1 && line <= lineCount
          ? [
              {
                range: new Range(
                  line,
                  1,
                  line,
                  currentModel!.getLineMaxColumn(line),
                ),
                options: {
                  isWholeLine: true,
                  shouldFillLineOnLineBreak: true,
                  className: "codeblocks-source-highlight",
                },
              },
            ]
          : [],
      );
    },
    setHighlightedLines(lines) {
      const currentModel = editor.getModel();
      const lineCount = currentModel?.getLineCount() ?? 0;
      persistentHighlights.set(
        lines
          .filter((line) => line >= 1 && line <= lineCount)
          .map((line) => ({
            range: new Range(
              line,
              1,
              line,
              currentModel!.getLineMaxColumn(line),
            ),
            options: {
              isWholeLine: true,
              shouldFillLineOnLineBreak: true,
              className: "codeblocks-persistent-line-highlight",
            },
          })),
      );
    },
    onDidHoverSourceLine(callback) {
      const subscription = editor.onMouseMove((event) =>
        callback(event.target.position?.lineNumber),
      );
      return () => subscription.dispose();
    },
    getMonacoEditor: () => editor,
    async setTheme(theme) {
      staging.style.background = themeBackground(theme);
      monacoEditorApi.setTheme(theme === "light" ? "vs" : "vs-dark");
      await shared.wrapper
        .getMonacoEditorApp()
        ?.updateUserConfiguration(userConfiguration(theme));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      shared.reporters.delete(report);
      editor.dispose();
      model?.dispose();
      staging.remove();
    },
    onDidChange(callback) {
      const subscription = editor.onDidChangeModelContent(() =>
        callback(editor.getValue()),
      );
      return () => subscription.dispose();
    },
    clangdReady: shared.clangdReady,
  };
}

async function initializeSharedRuntime(
  options: CreateCppEditorOptions,
  reporters: Set<StatusReporter>,
): Promise<SharedRuntime> {
  ensureStylesheet();
  const workerBootstraps = new Set<() => void>();
  (
    globalThis as typeof globalThis & { MonacoEnvironment: unknown }
  ).MonacoEnvironment = {
    getWorker: () => {
      const handle = createRemoteModuleWorker(editorWorkerUrl, {
        name: "monaco-editor-worker",
      });
      workerBootstraps.add(handle.disposeBootstrap);
      return handle.worker;
    },
  };

  const runtime = {} as SharedRuntime;
  const broadcast: StatusReporter = (status) => {
    if (status.type.startsWith("clangd-")) runtime.lastClangdStatus = status;
    reporters.forEach((reporter) => reporter(status));
  };
  let clangdHandle: ReturnType<typeof startClangd> | undefined;
  let rejectIsolation: ((error: Error) => void) | undefined;
  let isolatedFailure: Promise<void> | undefined;
  if (globalThis.crossOriginIsolated) {
    clangdHandle = startClangd(broadcast);
  } else {
    const error = new Error(
      "clangd requires cross-origin isolation because its WebAssembly build uses SharedArrayBuffer/pthreads.",
    );
    broadcast({ type: "clangd-error", error });
    isolatedFailure = new Promise<void>(
      (_, reject) => (rejectIsolation = reject),
    );
    void isolatedFailure.catch(() => {});
    rejectIsolation!(error);
  }

  const staging = createStaging(options.element, options.theme ?? "dark");
  const wrapper = new MonacoEditorLanguageClientWrapper();
  Object.assign(runtime, {
    wrapper,
    primaryStaging: staging,
    reporters,
    setWorkspaceFiles: (files: Array<{ filename: string; contents: string }>) =>
      clangdHandle?.setWorkspaceFiles(files),
  });

  let languageClientConfig: LanguageClientConfig | undefined;
  if (clangdHandle) {
    languageClientConfig = {
      languageId: LANGUAGE_ID,
      name: "Clangd WASM Language Server",
      options: { $type: "WorkerDirect", worker: clangdHandle.worker },
      clientOptions: {
        documentSelector: [LANGUAGE_ID],
        // The WASM clangd can report include-link ranges that VS Code rejects
        // before Monaco can validate them. Include links are not exposed by
        // this embedded UI, so avoid registering that provider.
        middleware: {
          provideDocumentLinks: () => [],
        },
        workspaceFolder: {
          index: 0,
          name: "workspace",
          uri: Uri.file(WORKSPACE_PATH),
        },
      },
      connectionProvider: {
        get: async () => ({
          reader: new BrowserMessageReader(clangdHandle!.worker),
          writer: new BrowserMessageWriter(clangdHandle!.worker),
        }),
      },
    };
  }

  const userConfig: UserConfig = {
    languageClientConfig,
    wrapperConfig: {
      serviceConfig: {
        workspaceConfig: {
          workspaceProvider: {
            trusted: true,
            workspace: { folderUri: Uri.file(WORKSPACE_PATH) },
            async open() {
              return false;
            },
          },
        },
        userServices: {
          ...getConfigurationServiceOverride(),
          ...getTextmateServiceOverride(),
          ...getThemeServiceOverride(),
        },
      },
      editorAppConfig: {
        $type: "extended",
        codeResources: { main: { text: options.value ?? "", uri: FILE_PATH } },
        userConfiguration: { json: userConfiguration(options.theme ?? "dark") },
        useDiffEditor: false,
        overrideAutomaticLayout: true,
        editorOptions: {
          ...defaultEditorOptions(options.theme ?? "dark"),
          ...options.editorOptions,
          scrollbar: {
            ...defaultEditorOptions(options.theme ?? "dark").scrollbar,
            ...options.editorOptions?.scrollbar,
            alwaysConsumeMouseWheel: false,
          },
          readOnly: options.readOnly ?? options.editorOptions?.readOnly,
          theme: options.theme === "light" ? "vs" : "vs-dark",
        },
      },
    },
    loggerConfig: { enabled: false, debugEnabled: false },
  };

  try {
    await wrapper.init(userConfig);
    const app = wrapper.getMonacoEditorApp();
    await app?.init();
    await app?.createEditors(staging);
  } catch (error) {
    clangdHandle?.dispose();
    workerBootstraps.forEach((dispose) => dispose());
    staging.remove();
    throw error;
  }

  const editor = wrapper.getEditor();
  if (!editor) throw new Error("Monaco did not create an editor instance");
  runtime.primaryEditor = editor;
  staging.style.visibility = "visible";

  runtime.clangdReady = clangdHandle
    ? clangdHandle.ready
        .then(async () => {
          await wrapper.getLanguageClientWrapper()?.start();
          broadcast({ type: "clangd-ready" });
        })
        .catch((value: unknown) => {
          const error =
            value instanceof Error ? value : new Error(String(value));
          broadcast({ type: "clangd-error", error });
          throw error;
        })
    : isolatedFailure!;
  void runtime.clangdReady.catch(() => {});
  return runtime;
}

function monacoLanguage(language = LANGUAGE_ID): string {
  const normalized = language.toLowerCase();
  return normalized === "c++" || normalized === "cxx"
    ? LANGUAGE_ID
    : normalized;
}

function modelPath(filename: string | undefined, sequence: number): string {
  const safeName = (filename ?? `codeblock-${sequence}.cpp`).replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
  return `/home/web_user/${sequence}-${safeName}`;
}

function createStaging(
  host: HTMLElement,
  theme: "light" | "dark",
): HTMLDivElement {
  const staging = document.createElement("div");
  staging.className = "clangd-browser-editor";
  staging.style.cssText = `position:absolute;inset:0;visibility:hidden;background:${themeBackground(theme)}`;
  host.append(staging);
  return staging;
}

function ensureStylesheet(): void {
  const href = new URL("../../codeblocks.css", import.meta.url).href;
  const alreadyLoaded = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
  ).some((link) => link.href === href);
  if (alreadyLoaded) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.dataset.codeblocksStyles = "";
  stylesheet.href = href;
  document.head.append(stylesheet);
}

function defaultEditorOptions(
  theme: "light" | "dark",
): MonacoEditor.IStandaloneEditorConstructionOptions {
  return {
    theme: theme === "light" ? "vs" : "vs-dark",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 14,
    lineHeight: 23,
    glyphMargin: false,
    folding: false,
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 6,
    minimap: { enabled: false },
    scrollbar: { alwaysConsumeMouseWheel: false },
    padding: { top: 16, bottom: 16 },
    scrollBeyondLastLine: false,
    fixedOverflowWidgets: true,
    links: false,
  };
}

function themeBackground(theme: "light" | "dark"): string {
  return theme === "light" ? "#ffffff" : "#1e1e1e";
}

function userConfiguration(theme: "light" | "dark"): string {
  return JSON.stringify({
    "workbench.colorTheme":
      theme === "light" ? "Default Light Modern" : "Default Dark Modern",
    "editor.wordBasedSuggestions": "off",
    "editor.inlayHints.enabled": "offUnlessPressed",
    "editor.quickSuggestionsDelay": 200,
  });
}
