# clangd browser runtime

This project packages Monaco and the WebAssembly build of clangd as a reusable browser component. It creates an editor only inside the element supplied by the host page; it does not use an iframe, register a service worker, replace page-level DOM, or own Run/output UI.

## Use the hosted runtime

The preferred deployment uses separate origins:

```text
https://www.example.com/       host page
https://clangd.example.com/    contents of dist/
```

The host can be ordinary HTML and JavaScript:

```html
<div class="editor-shell">
  <textarea id="fallback">int main() { return 0; }</textarea>
  <div id="monaco-host"></div>
</div>

<script type="module">
  const fallback = document.querySelector("#fallback");
  const host = document.querySelector("#monaco-host");
  const { createCppEditor } =
    await import("https://clangd.example.com/editor.js");

  const editor = await createCppEditor({
    element: host,
    value: fallback.value,
    theme: "dark",
    onStatus(status) {
      console.log(status);
    },
  });

  // Capture edits made while Monaco loaded, then swap only the editor nodes.
  editor.setValue(fallback.value);
  host.style.visibility = "visible";
  editor.layout();
  fallback.remove();

  await editor.clangdReady;
</script>
```

`createCppEditor()` resolves as soon as Monaco is usable. clangd downloads and starts independently; `editor.clangdReady` resolves after the language client connects and rejects if clangd is unavailable. A missing cross-origin-isolation policy affects clangd only; Monaco remains usable.

The returned component API is:

```js
editor.getValue();
editor.setValue(source);
editor.focus();
editor.layout();
editor.dispose();
const unsubscribe = editor.onDidChange((source) => {});
await editor.clangdReady;
```

### Lightweight fallback

The fallback editor is a separate, small public module and does not load Monaco:

```js
const { createCppFallbackEditor } =
  await import("https://clangd.example.com/fallback.js");

const fallback = createCppFallbackEditor({
  element: document.querySelector(".fallback-host"),
  value: "int main() { return 0; }",
});

fallback.getValue();
fallback.setValue("int main() { return 1; }");
fallback.focus();
const unsubscribe = fallback.onDidChange((source) => {});
fallback.dispose();
```

`fallback.js` contains its scoped styles, native textarea overlay, line numbers, scrolling synchronization, and lightweight C++ syntax highlighter. It can also enhance an existing textarea inside the supplied element, preserving source included in the initial HTML.

### ANSI output

ANSI SGR rendering is available from the main entry and as a lightweight standalone module:

```js
const { appendAnsi, ansiToFragment, stripAnsi } =
  await import("https://clangd.example.com/ansi.js");

appendAnsi(outputElement, compilerOutput);
appendAnsi(outputElement, stderr, { className: "stderr" });
```

The renderer creates text nodes and styled spans rather than injecting HTML. The same functions are also exported by `editor.js`.

Status events have a `type` of `monaco-loading`, `monaco-ready`, `clangd-downloading`, `clangd-starting`, `clangd-ready`, or `clangd-error`. Download events also contain `loaded` and, when the server provides it, `total` bytes.

See [demo/index.html](demo/index.html), [demo/demo.js](demo/demo.js), and [demo/demo.css](demo/demo.css) for a complete framework-free highlighted fallback editor, seamless handoff, ANSI-aware Run output, and Compiler Explorer link. The demo's **Show fallback / Show Monaco** toggle recreates the fallback on demand for visual comparison; the normal one-way startup handoff still removes and cleans up the fallback.

## Headers

The host document must be cross-origin isolated for clangd's SharedArrayBuffer/pthread build:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The runtime asset server must make its public modules, workers, CSS, and WASM available cross-origin:

```http
Access-Control-Allow-Origin: *
Cross-Origin-Resource-Policy: cross-origin
```

Serve `.wasm` as `application/wasm`. [public/_headers](public/_headers) is an example configuration for static hosts that support Netlify-style header files.

The cross-origin worker bootstrap uses Blob module workers. A restrictive host Content Security Policy therefore needs at least:

```http
Content-Security-Policy: worker-src blob:; script-src 'self' https://clangd.example.com blob:
```

Adjust the runtime origin and the rest of the policy for the site. The runtime never registers a service worker or attempts to change the host's COOP/COEP policy. GitHub Pages users need a fronting service capable of setting these headers, or a COI service-worker solution managed by the host site itself.

## Self-host the same package

Extract the archive without rebuilding:

```bash
mkdir -p assets/clangd
tar xf clangd-browser-runtime.tar.gz -C assets/clangd
```

Then import the exact same distribution from the host origin:

```js
const { createCppEditor } = await import("/assets/clangd/editor.js");
```

All resource URLs are relative to emitted modules, so the distribution works at the origin root or any directory such as `/assets/clangd/`.

## Build and package

Normal frontend builds use prebuilt artifacts and never clone or compile LLVM:

```bash
pnpm install
pnpm build
pnpm pack:runtime
```

The build produces stable `dist/editor.js`, `dist/fallback.js`, `dist/ansi.js`, `dist/editor.css`, internal chunks in `dist/assets/`, and the complete Emscripten artifact set in `dist/wasm/`. Packaging creates `clangd-browser-runtime.tar.gz`.

Install an existing artifact directory or archive with:

```bash
./scripts/install-clangd-artifacts path/to/clangd-artifacts.tar.gz
```

The input must contain `clangd.js`, `clangd.wasm`, and any other `clangd*` files produced by Emscripten. `build.sh` remains a separate manual reference workflow and is not invoked by `pnpm build` or CI.

## Cross-origin demo and tests

Build first, then start all acceptance origins:

```bash
pnpm build
pnpm demo:origins
```

- `http://localhost:4173` serves the demo host with COOP/COEP.
- `http://localhost:4174` serves runtime assets with CORS/CORP.
- `http://localhost:4175` serves the same runtime at `/assets/clangd/` for same-origin testing.
- `http://localhost:4176` serves a non-isolated host for graceful-degradation testing.

Run the Chromium acceptance suite with:

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

The tests cover immediate fallback editing and Run, delayed runtime/WASM, edit-preserving handoff, DOM ownership, cross-origin isolation and worker startup, real clangd diagnostics, failure behavior, and same-origin extraction layout.

## Compiler Explorer Run UI

Compilation is intentionally a host concern. The demo keeps an `activeEditor.getValue()` abstraction that initially reads the textarea and later points to Monaco, then sends that source directly to the Compiler Explorer API. This makes Run independent of both Monaco and clangd readiness.
