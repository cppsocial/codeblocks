import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import "@codingame/monaco-vscode-theme-defaults-default-extension";
import "@codingame/monaco-vscode-cpp-default-extension";
import { Uri } from "vscode";
import { BrowserMessageReader, BrowserMessageWriter } from "vscode-languageclient/browser";
import {
  LanguageClientConfig,
  MonacoEditorLanguageClientWrapper,
  UserConfig,
} from "monaco-editor-wrapper";
import editorWorkerUrl from "monaco-editor/esm/vs/editor/editor.worker?worker&url";
import { editor as monacoEditorApi } from "monaco-editor";
import type { editor as MonacoEditor } from "monaco-editor";
import { FILE_PATH, LANGUAGE_ID, WORKSPACE_PATH } from "../../clangd/config";
import { EditorStatus, startClangd, StatusReporter } from "../../clangd/client";
import { createRemoteModuleWorker } from "../../clangd/worker-bootstrap";
import "./runtime.css";

export type { EditorStatus } from "../../clangd/client";
export { ansiToFragment, appendAnsi, stripAnsi } from "../../terminal/ansi";

export interface CreateCppEditorOptions {
  element: HTMLElement;
  value?: string;
  theme?: "light" | "dark";
  editorOptions?: MonacoEditor.IStandaloneEditorConstructionOptions;
  onStatus?: (status: EditorStatus) => void;
}

export interface CppEditor {
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
  layout(): void;
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
}

interface SharedRuntimeSlot {
  promise: Promise<SharedRuntime>;
  reporters: Set<StatusReporter>;
}

const noop: StatusReporter = () => {};
let sharedSlot: SharedRuntimeSlot | undefined;
let editorSequence = 0;

export async function createCppEditor(options: CreateCppEditorOptions): Promise<CppEditor> {
  if (!(options.element instanceof HTMLElement)) {
    throw new TypeError("createCppEditor requires an HTMLElement in options.element");
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
    slot.promise = initializeSharedRuntime(options, reporters).catch((error) => {
      if (sharedSlot === slot) sharedSlot = undefined;
      throw error;
    });
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

  const staging = isPrimary
    ? shared.primaryStaging
    : createStaging(options.element, options.theme ?? "dark");
  let editor: MonacoEditor.IStandaloneCodeEditor;
  let model: MonacoEditor.ITextModel | undefined;

  if (isPrimary) {
    editor = shared.primaryEditor;
  } else {
    model = monacoEditorApi.createModel(
      options.value ?? "",
      LANGUAGE_ID,
      Uri.file(`/home/web_user/codeblock-${++editorSequence}.cpp`),
    );
    editor = monacoEditorApi.create(staging, {
      ...defaultEditorOptions(options.theme ?? "dark"),
      ...options.editorOptions,
      model,
      theme: options.theme === "light" ? "vs" : "vs-dark",
    });
    staging.style.visibility = "visible";
  }

  report({ type: "monaco-ready" });
  let disposed = false;
  return {
    getValue: () => editor.getValue(),
    setValue: (value) => editor.setValue(value),
    focus: () => editor.focus(),
    layout: () => editor.layout(),
    getMonacoEditor: () => editor,
    async setTheme(theme) {
      staging.style.background = themeBackground(theme);
      monacoEditorApi.setTheme(theme === "light" ? "vs" : "vs-dark");
      await shared.wrapper.getMonacoEditorApp()?.updateUserConfiguration(userConfiguration(theme));
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
      const subscription = editor.onDidChangeModelContent(() => callback(editor.getValue()));
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
  (globalThis as typeof globalThis & { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: () => {
      const handle = createRemoteModuleWorker(editorWorkerUrl, { name: "monaco-editor-worker" });
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
    isolatedFailure = new Promise<void>((_, reject) => (rejectIsolation = reject));
    void isolatedFailure.catch(() => {});
    rejectIsolation!(error);
  }

  const staging = createStaging(options.element, options.theme ?? "dark");
  const wrapper = new MonacoEditorLanguageClientWrapper();
  Object.assign(runtime, {
    wrapper,
    primaryStaging: staging,
    reporters,
  });

  let languageClientConfig: LanguageClientConfig | undefined;
  if (clangdHandle) {
    languageClientConfig = {
      languageId: LANGUAGE_ID,
      name: "Clangd WASM Language Server",
      options: { $type: "WorkerDirect", worker: clangdHandle.worker },
      clientOptions: {
        documentSelector: [LANGUAGE_ID],
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
          const error = value instanceof Error ? value : new Error(String(value));
          broadcast({ type: "clangd-error", error });
          throw error;
        })
    : isolatedFailure!;
  void runtime.clangdReady.catch(() => {});
  return runtime;
}

function createStaging(host: HTMLElement, theme: "light" | "dark"): HTMLDivElement {
  const staging = document.createElement("div");
  staging.className = "clangd-browser-editor";
  staging.style.cssText =
    `position:absolute;inset:0;visibility:hidden;background:${themeBackground(theme)}`;
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
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 14,
    lineHeight: 23,
    glyphMargin: false,
    folding: false,
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 6,
    minimap: { enabled: false },
    padding: { top: 16, bottom: 16 },
    scrollBeyondLastLine: false,
    fixedOverflowWidgets: true,
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
