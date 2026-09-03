/// <reference lib="WebWorker" />

import { COMPILE_ARGS, FILE_PATH, WORKSPACE_PATH } from "./config";
import { JsonStream } from "./json-stream";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
} from "vscode-languageserver/browser";
import { remoteModuleBootstrap } from "./worker-bootstrap";

declare const self: DedicatedWorkerGlobalScope;
declare const __CLANGD_WASM_BASE__: string;

type ClangdModule = {
  FS: {
    writeFile(path: string, contents: string): void;
    mkdirTree(path: string): void;
  };
  callMain(args: string[]): void;
};

type ClangdFactory = (
  options: Record<string, unknown>,
) => Promise<ClangdModule>;

type WorkspaceFile = { filename: string; contents: string };
const pendingWorkspaceFiles: WorkspaceFile[][] = [];
let installWorkspaceFiles: ((files: WorkspaceFile[]) => void) | undefined;
self.addEventListener("message", (event) => {
  if (event.data?.type !== "workspace-files") return;
  event.stopImmediatePropagation();
  const files = Array.isArray(event.data.files) ? event.data.files : [];
  if (installWorkspaceFiles) installWorkspaceFiles(files);
  else pendingWorkspaceFiles.push(files);
});

function unsignedLeb128(value: number): number[] {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return bytes;
}

function emptySourceMapSection(): Uint8Array {
  const encoder = new TextEncoder();
  const name = encoder.encode("sourceMappingURL");
  const url = encoder.encode(
    'data:application/json,{"version":3,"sources":[],"names":[],"mappings":""}',
  );
  const contents = new Uint8Array([
    ...unsignedLeb128(name.length),
    ...name,
    ...unsignedLeb128(url.length),
    ...url,
  ]);
  return new Uint8Array([0, ...unsignedLeb128(contents.length), ...contents]);
}

async function download(url: URL, suffix?: Uint8Array): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download clangd.wasm (${response.status})`);
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      self.postMessage({ type: "progress", loaded });
    }
  }

  const bytes = new Uint8Array(loaded + (suffix?.length ?? 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (suffix) bytes.set(suffix, loaded);
  return bytes;
}

async function start(): Promise<void> {
  // In production this worker is emitted into assets/, beside the runtime's
  // other chunks. The manually installed Emscripten files live in wasm/.
  const wasmBase = __CLANGD_WASM_BASE__
    ? new URL(__CLANGD_WASM_BASE__)
    : new URL("../wasm/", import.meta.url);
  const clangdJsUrl = new URL("clangd.js", wasmBase);
  const clangdWasmUrl = new URL("clangd.wasm", wasmBase);

  const modulePromise = import(/* @vite-ignore */ clangdJsUrl.href) as Promise<{
    default: ClangdFactory;
  }>;
  // Firefox asks every instantiated Wasm module for a source-map URL. Give it
  // a valid, empty map instead of letting DevTools try to resolve `null` against
  // the synthetic URL assigned to an ArrayBuffer-instantiated module.
  const wasmBinary = await download(clangdWasmUrl, emptySourceMapSection());
  self.postMessage({ type: "starting" });

  const { default: Clangd } = await modulePromise;
  const textEncoder = new TextEncoder();
  let resolveStdinReady = () => {};
  const stdinChunks: string[] = [];
  const currentStdinChunk: (number | null)[] = [];

  const stdin = (): number | null => {
    if (currentStdinChunk.length === 0) {
      const nextChunk = stdinChunks.shift();
      if (nextChunk === undefined) return null;
      currentStdinChunk.push(...textEncoder.encode(nextChunk), null);
    }
    return currentStdinChunk.shift()!;
  };

  const jsonStream = new JsonStream();
  let writer: BrowserMessageWriter;
  const stdout = (charCode: number) => {
    const json = jsonStream.insert(charCode);
    if (json !== null) writer.write(JSON.parse(json));
  };
  const stdinReady = () =>
    stdinChunks.length === 0
      ? new Promise<void>((resolve) => (resolveStdinReady = resolve))
      : undefined;
  const onAbort = (reason: unknown) => {
    writer?.end();
    throw reason instanceof Error ? reason : new Error(String(reason));
  };

  const clangd = await Clangd({
    thisProgram: "/usr/bin/clangd",
    wasmBinary,
    // Emscripten uses this same module as its pthread entry point. Supplying a
    // Blob makes every pthread worker same-origin even when clangd.js is remote.
    mainScriptUrlOrBlob: remoteModuleBootstrap(clangdJsUrl.href),
    locateFile: (path: string) => new URL(path, wasmBase).href,
    stdinReady,
    stdin,
    stdout,
    stderr: () => {},
    onExit: onAbort,
    onAbort,
  });

  installWorkspaceFiles = (files) => {
    for (const file of files) {
      const filename = safeWorkspaceFilename(file.filename);
      if (!filename) continue;
      const path = `${WORKSPACE_PATH}/${filename}`;
      const parent = path.slice(0, path.lastIndexOf("/"));
      clangd.FS.mkdirTree(parent);
      clangd.FS.writeFile(path, String(file.contents ?? ""));
    }
  };
  for (const files of pendingWorkspaceFiles.splice(0)) {
    installWorkspaceFiles(files);
  }

  const flags = [
    ...COMPILE_ARGS,
    "--target=wasm32-wasi",
    "-isystem/usr/include/c++/v1",
    "-isystem/usr/include/wasm32-wasi/c++/v1",
    "-isystem/usr/include",
    "-isystem/usr/include/wasm32-wasi",
  ];
  clangd.FS.writeFile(FILE_PATH, "");
  clangd.FS.writeFile(
    `${WORKSPACE_PATH}/.clangd`,
    JSON.stringify({ CompileFlags: { Add: flags } }),
  );
  // One clangd process serves every editor model, so a single asynchronous
  // worker avoids scaling its internal thread demand with the host CPU count.
  // The in-memory workspace does not benefit from a persistent background index.
  clangd.callMain(["-j=1", "--background-index=0"]);

  const reader = new BrowserMessageReader(self);
  writer = new BrowserMessageWriter(self);
  reader.listen((data) => {
    const body = JSON.stringify(data).replace(
      /[\u007F-\uFFFF]/g,
      (character) =>
        `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`,
    );
    stdinChunks.push(`Content-Length: ${body.length}\r\n`, "\r\n", body);
    resolveStdinReady();
  });
  self.postMessage({ type: "ready" });
}

function safeWorkspaceFilename(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.replaceAll("\\", "/").split("/");
  if (
    !parts.length ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    return undefined;
  return parts.join("/");
}

start().catch((error: unknown) => {
  self.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  throw error;
});
