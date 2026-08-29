import clangdWorkerUrl from "./clangd.worker?worker&url";
import { createRemoteModuleWorker } from "./worker-bootstrap";

export type EditorStatus =
  | { type: "monaco-loading" }
  | { type: "monaco-ready" }
  | { type: "clangd-downloading"; loaded: number; total?: number }
  | { type: "clangd-starting" }
  | { type: "clangd-ready" }
  | { type: "clangd-error"; error: Error };

export type StatusReporter = (status: EditorStatus) => void;

export interface ClangdWorkerHandle {
  worker: Worker;
  ready: Promise<void>;
  dispose(): void;
}

export function startClangd(report: StatusReporter): ClangdWorkerHandle {
  const { worker, disposeBootstrap } = createRemoteModuleWorker(clangdWorkerUrl, {
    name: "clangd-language-server",
  });

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // clangdReady is deliberately allowed to reject independently of the editor.
  // Attach an internal handler so a host that ignores it gets no unhandled event.
  void ready.catch(() => {});

  let settled = false;
  const fail = (value: unknown) => {
    if (settled) return;
    settled = true;
    const error =
      value instanceof ErrorEvent
        ? value.error ?? new Error(value.message)
        : value instanceof Error
          ? value
          : new Error(String(value));
    report({ type: "clangd-error", error });
    rejectReady(error);
  };
  worker.addEventListener("error", fail);
  worker.addEventListener("messageerror", fail);
  worker.addEventListener("message", (event: MessageEvent) => {
    switch (event.data?.type) {
      case "progress":
        report({
          type: "clangd-downloading",
          loaded: event.data.loaded,
          total: event.data.total,
        });
        break;
      case "starting":
        report({ type: "clangd-starting" });
        break;
      case "ready":
        if (!settled) {
          settled = true;
          resolveReady();
        }
        break;
      case "error":
        fail(new Error(event.data.message));
        break;
    }
  });

  return {
    worker,
    ready,
    dispose() {
      worker.terminate();
      disposeBootstrap();
      if (!settled) fail(new Error("clangd was disposed before it became ready"));
    },
  };
}
