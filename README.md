# clangd in the browser

This package turns ordinary `<codeblock>` tags into editable, runnable C++ examples. It starts with a small textarea editor, upgrades to Monaco when the main bundle is ready, and runs a WebAssembly build of clangd for code help. Multiple blocks on one page share the same runtime, worker, and clangd download.

## Add a code block

Copy the complete contents of `dist/` to one public directory, then include one stylesheet and one classic script:

```html
<link rel="stylesheet" href="./codeblocks.css" />
<script src="./codeblocks.js"></script>

<codeblock compiler="gsnapshot" args="-std=c++26 -freflection">
#include &lt;print&gt;
int main() {
    std::println("foo {} bar", 42);
}
</codeblock>
```

Angle brackets in source code must use normal HTML escaping, such as `&lt;print&gt;`, because the code is embedded in an HTML document.

Add as many `<codeblock>` elements as needed. Tags inserted later are upgraded automatically. Monaco, clangd, and the WebAssembly file are initialized once per page.

A block can also contain multiple tabbed sources:

```html
<codeblock compiler="clang2110" args="-std=c++23" height="360px">
  <codeblock-tab name="first.cpp">
int main() { return 1; }
  </codeblock-tab>
  <codeblock-tab name="second.cpp">
int main() { return 2; }
  </codeblock-tab>
</codeblock>
```

Each tab keeps its own source. Run compiles the active tab. Use separate `<codeblock>` elements when examples need different compiler settings.

Supported attributes are:

- `compiler`: Compiler Explorer compiler ID, defaulting to `clang2110`.
- `args`: arguments sent unchanged to Compiler Explorer.
- `ce-url`: Compiler Explorer base URL, defaulting to `https://godbolt.org/`.
- `ce-language`: language stored in the Compiler Explorer client state, defaulting to `c++`.
- `ce-compiler`: override the linked Compiler Explorer compiler without changing Run.
- `ce-options`: override the linked Compiler Explorer arguments without changing Run.
- `ce-filters`: JSON object overriding Compiler Explorer output filters, such as `'{"intel":false,"demangle":true}'`.
- `theme`: `auto`, `light`, or `dark`.
- `debug`: show the basic/full editor and light/dark switches. These are hidden by default.
- `width`: any valid CSS width for the complete block.
- `height`: any valid CSS height for the editor area, such as `280px`, `40vh`, or `clamp(240px, 50vh, 600px)`.
- `min-height`: any valid CSS minimum height for the editor area.

## JavaScript API

`codeblocks.js` creates `globalThis.CodeBlocks` immediately. Its `ready` promise resolves after the module API has loaded:

```html
<script>
  CodeBlocks.configure({
    theme: "dark",
    editorOptions: {
      fontSize: 15,
      wordWrap: "on",
    },
    styles: {
      "editor-height": "360px",
      "accent": "#7c3aed",
    },
  });

  CodeBlocks.ready.then(() => {
    const element = document.querySelector("codeblock");
    const block = CodeBlocks.get(element);
    block.setValue("int main() { return 0; }");
  });
</script>
```

Call `CodeBlocks.configure(options)` before a block is upgraded to set defaults for later blocks. The available options are `theme`, `showDebugControls`, `compiler`, `args`, `compilerExplorer`, `editorOptions`, `styles`, and `onStatus`.

The Compiler Explorer link contains the active source, filename, compiler, arguments, and output filters in its `/clientstate/` URL. No upload or short-link request is needed. Client-state fields can be overridden globally or when creating an individual block:

```js
CodeBlocks.configure({
  compilerExplorer: {
    baseUrl: "https://godbolt.org/",
    language: "c++",
    compiler: "gsnapshot",
    options: "-std=c++26 -O2",
    filters: {
      intel: false,
      demangle: true,
      commentOnly: false,
    },
    libs: [],
    specialoutputs: [],
    tools: [],
    overrides: [],
  },
});
```

The legacy `compilerExplorerUrl` JavaScript option remains available as an alias for `compilerExplorer.baseUrl`.

`CodeBlocks.get(element)` returns the upgraded block instance. It exposes `getValue`, `setValue`, `getTabs`, `selectTab`, `getCompilerExplorerUrl`, `focus`, `run`, `setTheme`, `dispose`, `onDidChange`, `editorReady`, `monacoReady`, and `clangdReady`. `getValue` and `setValue` act on the active tab. `monacoReady` resolves to the underlying Monaco standalone editor for integrations that need the native editor API.

Styling uses CSS custom properties. Common properties include:

```css
codeblock {
  width: min(100%, 900px);
  --codeblocks-editor-height: 360px;
  --codeblocks-editor-min-height: 120px;
  --codeblocks-editor-height-mobile: 300px;
  --codeblocks-accent: #7c3aed;
  --codeblocks-border: #475569;
}
```

The editor observes its container and relayouts whenever its width or height changes, including flexbox, grid, responsive, and script-driven resizing.

Debug mode also writes lifecycle messages to the browser console, including Monaco loading/loaded, clangd download progress, clangd starting/loaded/activated, and complete clangd error messages. Add `data-debug` to the loader script to include loader, HTTPS, service-worker, and isolation messages:

```html
<script
  src="./codeblocks.js"
  data-coi-serviceworker="./coi-serviceworker.js"
  data-debug
></script>
```

The lower-level ES module entries remain available as `editor.js`, `fallback.js`, and `ansi.js`.

## Cross-origin isolation

clangd uses WebAssembly threads and therefore requires `crossOriginIsolated === true`. The preferred deployment sends these response headers for the document and same-origin runtime files:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The reusable loader does not register a service worker by default. Hosts such as GitHub Pages that cannot set these headers can explicitly opt into the included helper:

```html
<script
  src="./codeblocks.js"
  data-coi-serviceworker="./coi-serviceworker.js"
></script>
```

That opt-in registers a host-owned service worker and reloads once. Do not use the attribute when the server already sends the headers.

WebAssembly threads, service workers, and cross-origin isolation require a secure context. Enable "Enforce HTTPS" for a GitHub Pages custom domain. When the isolation helper is enabled, the loader also redirects non-local HTTP pages to the same HTTPS URL as a fallback. The included `clangd.cpp.social` example redirects before loading its external CSS or JavaScript.

If assets are hosted on another origin, that origin must allow CORS and send `Cross-Origin-Resource-Policy: cross-origin` or an equivalent policy accepted by the embedding page.

## Build and test

The repository already contains the prebuilt clangd artifacts in `public/wasm`. Front-end changes do not rebuild LLVM or clangd.

```bash
pnpm install
pnpm build
pnpm demo:origins
```

Open `http://localhost:4173/`. The example includes `debug`, so both visual editor and theme switches are shown.

Run the browser suite in another terminal:

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

Create a deployable archive with:

```bash
pnpm pack:runtime
```

The output is `clangd-browser-runtime.tar.gz`. It includes the main code-block files, lower-level entries, internal chunks, and prebuilt WebAssembly artifacts.
