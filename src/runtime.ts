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
import { FILE_PATH, LANGUAGE_ID, WORKSPACE_PATH } from "./config";
import { EditorStatus, startClangd, StatusReporter } from "./runtime/clangd";
import { createRemoteModuleWorker } from "./runtime/worker-bootstrap";
import "./runtime.css";

export type { EditorStatus } from "./runtime/clangd";
export { ansiToFragment, appendAnsi, stripAnsi } from "./ansi";

export interface CreateCppEditorOptions {
  element: HTMLElement;
  value?: string;
  theme?: "light" | "dark";
  onStatus?: (status: EditorStatus) => void;
}

export interface CppEditor {
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
  layout(): void;
  dispose(): void;
  onDidChange(callback: (value: string) => void): () => void;
  clangdReady: Promise<void>;
}

const noop: StatusReporter = () => {};

export async function createCppEditor(
  options: CreateCppEditorOptions,
): Promise<CppEditor> {
  if (!(options.element instanceof HTMLElement)) {
    throw new TypeError("createCppEditor requires an HTMLElement in options.element");
  }

  const report = options.onStatus ?? noop;
  report({ type: "monaco-loading" });

  const workerBootstraps = new Set<() => void>();
  (globalThis as typeof globalThis & { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: () => {
      const handle = createRemoteModuleWorker(editorWorkerUrl, {
        name: "monaco-editor-worker",
      });
      workerBootstraps.add(handle.disposeBootstrap);
      return handle.worker;
    },
  };

  let clangdHandle: ReturnType<typeof startClangd> | undefined;
  let rejectIsolation: ((error: Error) => void) | undefined;
  let isolatedFailure: Promise<void> | undefined;
  if (globalThis.crossOriginIsolated) {
    clangdHandle = startClangd(report);
  } else {
    const error = new Error(
      "clangd requires cross-origin isolation because its WebAssembly build uses SharedArrayBuffer/pthreads.",
    );
    report({ type: "clangd-error", error });
    isolatedFailure = new Promise<void>((_, reject) => (rejectIsolation = reject));
    void isolatedFailure.catch(() => {});
    rejectIsolation!(error);
  }

  const staging = document.createElement("div");
  staging.className = "clangd-browser-editor";
  staging.style.cssText = "position:absolute;inset:0;visibility:hidden";
  options.element.append(staging);

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  // This module is emitted in assets/, while the stable stylesheet is at the
  // distribution root beside editor.js.
  stylesheet.href = new URL("../editor.css", import.meta.url).href;
  options.element.prepend(stylesheet);

  const wrapper = new MonacoEditorLanguageClientWrapper();
  let languageClientConfig: LanguageClientConfig | undefined;
  if (clangdHandle) {
    const reader = new BrowserMessageReader(clangdHandle.worker);
    const writer = new BrowserMessageWriter(clangdHandle.worker);
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
      connectionProvider: { get: async () => ({ reader, writer }) },
    };
  }

  const userConfig: UserConfig = {
    languageClientConfig,
    wrapperConfig: {
      serviceConfig: {
        workspaceConfig: {
          workspaceProvider: {
            trusted: true,
            workspace: { workspaceUri: Uri.file(WORKSPACE_PATH) },
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
        codeResources: {
          main: { text: options.value ?? "", uri: FILE_PATH },
        },
        userConfiguration: {
          json: JSON.stringify({
            "workbench.colorTheme":
              options.theme === "light"
                ? "Default Light Modern"
                : "Default Dark Modern",
            "editor.wordBasedSuggestions": "off",
            "editor.inlayHints.enabled": "offUnlessPressed",
            "editor.quickSuggestionsDelay": 200,
          }),
        },
        useDiffEditor: false,
        overrideAutomaticLayout: true,
        editorOptions: {
          theme: options.theme === "light" ? "vs" : "vs-dark",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 14,
          lineHeight: 23,
          glyphMargin: false,
          folding: false,
          lineNumbersMinChars: 3,
          lineDecorationsWidth: 6,
          minimap: { enabled: false },
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
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
    staging.remove();
    stylesheet.remove();
    throw error;
  }

  const editor = wrapper.getEditor();
  if (!editor) throw new Error("Monaco did not create an editor instance");
  staging.style.visibility = "visible";
  report({ type: "monaco-ready" });

  const clangdReady = clangdHandle
    ? clangdHandle.ready.then(async () => {
        await wrapper.getLanguageClientWrapper()?.start();
        report({ type: "clangd-ready" });
      }).catch((value: unknown) => {
        const error = value instanceof Error ? value : new Error(String(value));
        report({ type: "clangd-error", error });
        throw error;
      })
    : isolatedFailure!;
  void clangdReady.catch(() => {});

  let disposed = false;
  return {
    getValue: () => editor.getValue(),
    setValue: (value) => editor.setValue(value),
    focus: () => editor.focus(),
    layout: () => editor.layout(),
    dispose() {
      if (disposed) return;
      disposed = true;
      clangdHandle?.dispose();
      void wrapper.dispose(true);
      workerBootstraps.forEach((dispose) => dispose());
      workerBootstraps.clear();
      staging.remove();
      stylesheet.remove();
    },
    onDidChange(callback) {
      const subscription = editor.onDidChangeModelContent(() =>
        callback(editor.getValue()),
      );
      return () => subscription.dispose();
    },
    clangdReady,
  };
}
