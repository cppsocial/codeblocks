const monacoHost = document.querySelector("[data-monaco-host]");
const editorShell = document.querySelector(".editor-shell");
const runButton = document.querySelector("[data-run]");
const editorToggle = document.querySelector("[data-editor-toggle]");
const outputDrawer = document.querySelector("[data-output-drawer]");
const output = document.querySelector("[data-output]");
const status = document.querySelector("[data-status]");
const initialFallbackHost = document.querySelector("[data-fallback]");
const initialTextarea = initialFallbackHost.querySelector("textarea");

const params = new URLSearchParams(location.search);
const editorUrl = params.get("runtime") ?? "./editor.js";
const runtimeBase = new URL(".", new URL(editorUrl, location.href));
const editorModulePromise = import(editorUrl);
const fallbackModulePromise = import(new URL("fallback.js", runtimeBase));
const ansiModulePromise = import(new URL("ansi.js", runtimeBase));

let fallbackEditor = {
  element: initialFallbackHost,
  getValue: () => initialTextarea.value,
  focus: () => initialTextarea.focus(),
  dispose: () => {},
};
let activeEditor = fallbackEditor;
let monacoEditor;

runButton.addEventListener("click", async () => {
  const originalLabel = runButton.textContent;
  runButton.disabled = true;
  runButton.textContent = "Running...";
  outputDrawer.hidden = false;
  output.textContent = "Compiling...";
  try {
    const result = await runCode(activeEditor.getValue());
    const diagnostics = lines(result.buildResult?.stderr);
    const stdout = lines(result.stdout);
    const stderr = lines(result.stderr);
    const { appendAnsi } = await ansiModulePromise;
    output.replaceChildren();
    if (result.didExecute) {
      if (!stdout && !stderr) {
        output.textContent = "Program completed with no output.";
      } else {
        appendAnsi(output, stdout);
        if (stdout && stderr) output.append("\n");
        appendAnsi(output, stderr, { className: "stderr" });
      }
    } else {
      appendAnsi(output, diagnostics || "Compilation failed without diagnostics.");
    }
  } catch (error) {
    output.textContent = `Run failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    runButton.disabled = false;
    runButton.textContent = originalLabel;
  }
});

editorToggle.addEventListener("click", async () => {
  if (!monacoEditor) return;
  if (fallbackEditor) {
    monacoEditor.setValue(fallbackEditor.getValue());
    removeFallback();
    monacoHost.hidden = false;
    monacoHost.classList.add("is-ready");
    monacoEditor.layout();
    activeEditor = monacoEditor;
    editorToggle.textContent = "Show fallback";
  } else {
    monacoHost.classList.remove("is-ready");
    monacoHost.hidden = true;
    fallbackEditor = await createFallback(monacoEditor.getValue());
    activeEditor = fallbackEditor;
    editorToggle.textContent = "Show Monaco";
  }
});

function removeFallback() {
  if (!fallbackEditor) return;
  const element = fallbackEditor.element;
  fallbackEditor.dispose();
  element.remove();
  fallbackEditor = null;
}

async function createFallback(value, element) {
  const { createCppFallbackEditor } = await fallbackModulePromise;
  const host = element ?? document.createElement("div");
  host.classList.add("fallback-host");
  host.dataset.fallback = "";
  if (!host.isConnected) editorShell.prepend(host);
  return createCppFallbackEditor({ element: host, value });
}

function lines(values = []) {
  return values.map((value) => value.text).join("\n");
}

async function runCode(source) {
  const response = await fetch("https://godbolt.org/api/compiler/clang2110/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      source,
      compiler: "clang2110",
      lang: "c++",
      options: {
        userArguments: "-std=c++2c -Wall -Wextra -pedantic-errors",
        compilerOptions: { executorRequest: true },
        executeParameters: { args: [], stdin: "" },
        filters: { execute: true },
      },
    }),
  });
  if (!response.ok) throw new Error(`Compiler Explorer returned ${response.status}`);
  return response.json();
}

try {
  const sourceBeforeEnhancement = fallbackEditor.getValue();
  fallbackEditor = await createFallback(sourceBeforeEnhancement, initialFallbackHost);
  activeEditor = fallbackEditor;

  const { createCppEditor } = await editorModulePromise;
  const editor = await createCppEditor({
    element: monacoHost,
    value: fallbackEditor.getValue(),
    theme: "dark",
    onStatus(event) {
      if (event.type === "monaco-loading") status.textContent = "Loading Monaco...";
      if (event.type === "monaco-ready" && status.textContent === "Loading Monaco...") status.textContent = "Monaco ready - loading clangd...";
      if (event.type === "clangd-downloading") {
        const percent = event.total ? ` ${Math.round(event.loaded / event.total * 100)}%` : "";
        status.textContent = `Loading clangd...${percent}`;
      }
      if (event.type === "clangd-starting") status.textContent = "Starting clangd...";
      if (event.type === "clangd-ready") status.textContent = "Monaco + clangd ready";
      if (event.type === "clangd-error"){ 
        status.textContent = "Monaco ready - clangd unavailable";
        console.error(event);
      }
      
    },
  });

  editor.setValue(fallbackEditor.getValue());
  monacoHost.classList.add("is-ready");
  editor.layout();
  removeFallback();
  activeEditor = editor;
  monacoEditor = editor;
  window.cppEditor = editor;
  editorToggle.disabled = false;
  editorToggle.textContent = "Show fallback";
} catch (error) {
  status.textContent = "Native editor active - runtime unavailable";
  editorToggle.textContent = "Monaco unavailable";
  console.error(error);
}
