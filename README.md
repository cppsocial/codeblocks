# clangd in the browser

This package turns ordinary `<codeblock>` tags into editable, runnable C++ examples. It starts with a small textarea editor, upgrades to Monaco when the main bundle is ready, and runs a WebAssembly build of clangd for code help. Multiple blocks on one page share the same runtime, worker, and clangd download.

This project started as a fork of the excellent https://github.com/guyutongxue/clangd-in-browser/.

## Add a code block

Copy the complete contents of `dist/` to one public directory, then include one stylesheet and one classic script:

```html
<link rel="stylesheet" href="./codeblocks.css" />
<script src="./codeblocks.js"></script>

<codeblock compiler="gsnapshot" args="-std=c++26 -freflection">
  #include &lt;print&gt; int main() { std::println("foo {} bar", 42); }
</codeblock>
```

Angle brackets in source code must use normal HTML escaping, such as `&lt;print&gt;`, because the code is embedded in an HTML document.

Add as many `<codeblock>` elements as needed. Tags inserted later are upgraded automatically. Monaco, clangd, and the WebAssembly file are initialized once per page.

A block can also contain multiple tabbed sources:

```html
<codeblock compiler="clang2110" args="-std=c++23" height="360px">
  <codeblock-tab name="first.cpp"> int main() { return 1; } </codeblock-tab>
  <codeblock-tab name="second.cpp"> int main() { return 2; } </codeblock-tab>
</codeblock>
```

Each tab keeps its own source. Run compiles the active tab. Use separate `<codeblock>` elements when examples need different compiler settings.

Supported attributes are:

- `compiler`: Compiler Explorer compiler ID, defaulting to `clang2110`.
- `args`: arguments sent unchanged to Compiler Explorer.
- `ce-url`: Compiler Explorer base URL, defaulting to `https://godbolt.org/`.
- `ce-language`: language stored in the Compiler Explorer client state, defaulting to `c++`.
- `ce-compiler`: legacy fallback for the compiler when `compiler` is absent.
- `ce-options`: legacy fallback for arguments when `args` is absent.
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
      accent: "#7c3aed",
    },
  });

  CodeBlocks.ready.then(() => {
    const element = document.querySelector("codeblock");
    const block = CodeBlocks.get(element);
    block.setValue("int main() { return 0; }");
  });
</script>
```

Call `CodeBlocks.configure(options)` before a block is upgraded to set defaults
for later blocks. The available options are `theme`, `showDebugControls`,
`compiler`, `args`, `compilerExplorer`, `editorOptions`, `styles`,
`renderOutput`, `onResult`, and `onStatus`.

The Compiler Explorer link contains the active source, filename, compiler,
arguments, execution view, and output filters in its `/clientstate/` URL. No
upload or short-link request is needed. Additional client-state fields can be
configured globally or when creating an individual block. The nested
`compiler` and `options` values are fallbacks; the code box's top-level
`compiler` and `args` always win so Run and the link cannot diverge:

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

`CodeBlocks.get(element)` returns the upgraded block instance. It exposes
`getValue`, `setValue`, `getTabs`, `selectTab`, `getCompilerExplorerUrl`,
`focus`, `compile`, `run`, `setTheme`, `dispose`, `onDidChange`, `editorReady`,
`monacoReady`, and `clangdReady`. `getValue` and `setValue` act on the active
tab. `monacoReady` resolves to the underlying Monaco standalone editor for
integrations that need the native editor API.

`compile()` is the presentation-independent path: it returns the structured
Compiler Explorer JSON result, including execution output and assembly. Set
`renderOutput: false` to suppress the built-in drawer, and use `onResult` to
observe results produced by either `compile()` or the Run button. The exported
`compileWithCompilerExplorer(request)` function is available for consumers that
do not need a code-block UI at all.

Run and the generated Compiler Explorer link resolve one shared compiler,
language, and argument set. The link enables execution and includes both the
assembly compiler and an execution/output view using that same compiler ID and
options.

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

The lower-level ES module entries remain available as `editor.js`, `fallback.js`,
and `ansi.js`. The fallback editor is language-agnostic internally; its current
C++ adapter uses [Microlighter](https://github.com/davatron5000/microlighter),
which applies an on-demand TextMate grammar through the CSS Custom Highlight
API while keeping the code DOM as plain text.

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

Installing dependencies downloads the latest verified prebuilt clangd artifacts
into `public/wasm` and builds the self-contained distribution. Front-end changes
do not rebuild LLVM or clangd.

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

The heavyweight LLVM/clangd build recipe and its required source patch live in
`scripts/clangd/`. Front-end work normally uses released artifacts. To build
clangd itself, run `scripts/clangd/build.sh`; to install a local artifact set,
run `scripts/clangd/install-artifacts.sh PATH`.

The TypeScript source is split by responsibility: `codeblocks/` owns UI
orchestration, `compiler-explorer/` owns the headless API and link state,
`editor/` contains fallback and Monaco adapters, `languages/` contains small
syntax adapters, and `clangd/` owns the WebAssembly worker transport. Files at
the top of `src/` are stable public build entrypoints.

## npm packages

The release workflow publishes two scoped packages from the same source and version:

- `@cppsocial/codeblocks` is self-contained and includes the clangd JavaScript
  and WebAssembly files from `public/wasm/`.
- `@cppsocial/codeblocks-hosted` loads the clangd WebAssembly assets hosted at
  `https://clangd.cpp.social/wasm/`.

Install the self-contained package from npm or directly from the GitHub
repository:

```bash
npm install @cppsocial/codeblocks
npm install github:cppsocial/codeblocks
```

The GitHub form downloads the verified clangd artifacts and builds the package
during installation. The smaller hosted variant is available from npm as
`@cppsocial/codeblocks-hosted`.

Both packages contain the classic loader as the `./loader` export, the stylesheet
as `./styles.css`, the typed ES module API at the package root, and every emitted
chunk and worker required by that build.

Local packaging never downloads artifacts. It uses the files already present in
`public/wasm/`, so a manual package is built from exactly the current checkout:

```bash
pnpm build
pnpm package:npm
npm pack ./packages/codeblocks
```

Publishing is restricted to the `Publish npm packages` workflow and GitHub
releases whose tag is `npm/<package-version>` and title is
`npm: <package-version>`. Its preparation step downloads and verifies the newest
`clangd-wasm/*` release before either distribution is built.
The packages are then published using npm trusted publishing and provenance.

For the initial npm setup, publish the two placeholder packages once:

```bash
npm publish ./bootstrap/codeblocks
npm publish ./bootstrap/codeblocks-hosted
```

Then configure `publish-npm.yaml` as the trusted GitHub Actions publisher for
both packages in npm, with `npm publish` allowed. Subsequent versions must only
be published by the release workflow.

Create a deployable archive with:

```bash
pnpm pack:runtime
```

The output is `clangd-browser-runtime.tar.gz`. It includes the main code-block files, lower-level entries, internal chunks, and prebuilt WebAssembly artifacts.

## Release clangd artifacts

The Pages workflow downloads `clangd.js`, `clangd.wasm`, and `SHA256SUMS` from the newest published repository release whose tag identifies it as a clangd WebAssembly release:

```text
clangd-wasm/<release-id>
```

To publish the artifacts currently in `public/wasm`, install and authenticate the GitHub CLI and run this locally:

```bash
pnpm release:wasm
```

The default release ID is a UTC timestamp. An explicit ID can be supplied when a recognizable version is preferable:

```bash
pnpm release:wasm -- llvm-22.0.0
```

The script validates both artifacts, creates `SHA256SUMS`, targets the current commit, and refuses duplicate release tags. CI only downloads the latest repository-wide release in the `clangd-wasm/` tag namespace; it does not create or build releases.

The repository is read from the `origin` GitHub remote and passed explicitly to `gh`. If the remote is named differently or does not use a standard GitHub URL, set `GH_REPO=owner/repository` when running the command.
