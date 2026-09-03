# clangd in the browser

This package turns ordinary `<codeblock>` tags into editable, runnable examples. It starts with an immediate syntax-highlighted simple editor, upgrades to Monaco when the block approaches the viewport, and runs a WebAssembly build of clangd for C++ code help. Multiple blocks share one VS Code runtime, worker, clangd process, and download.

This project started as a fork of the excellent https://github.com/guyutongxue/clangd-in-browser/.

## Add a code block

Copy the complete contents of `dist/` to one public directory, then include one stylesheet and one classic script:

```html
<link rel="stylesheet" href="./codeblocks.css" />
<script src="./codeblocks.js"></script>

<codeblock compiler="gsnapshot" compiler-args="-std=c++26 -freflection">
  #include &lt;print&gt; int main() { std::println("foo {} bar", 42); }
</codeblock>
```

Angle brackets in source code must use normal HTML escaping, such as `&lt;print&gt;`, because the code is embedded in an HTML document.

Add as many `<codeblock>` elements as needed. Tags inserted later are upgraded automatically. Monaco, clangd, and the WebAssembly file are initialized once per page.

A block can also contain multiple tabbed sources:

```html
<codeblock compiler="clang2110" compiler-args="-std=c++23" height="360px">
  <codeblock-tab name="first.cpp"> int main() { return 1; } </codeblock-tab>
  <codeblock-tab name="second.cpp"> int main() { return 2; } </codeblock-tab>
</codeblock>
```

Tabs are independent examples by default. Add `multi-file` to send the inactive
tabs to Compiler Explorer as extra files. A hidden supporting tab implies
multi-file mode. Use `build-system="cmake"` and a hidden `CMakeLists.txt` tab
for a CMake request. Switching independent or grouped tabs always clears stale
output.

Supported attributes are:

- `language`: editor/simple-mode and Compiler Explorer language, defaulting to `c++`.
- `compiler`: Compiler Explorer compiler ID. C++ defaults to `clang2110`; languages without an explicit default require this attribute.
- `compiler-args` (JavaScript: `compiler_args`): arguments sent to the compiler. The old `args` name remains a deprecated alias.
- `run-args` (JavaScript: `run_args`): arguments passed to the compiled program.
- `stdin`: standard input passed to the compiled program.
- `output-views`: comma-separated `execution`, `compiler`, `assembly`, or `tool:TOOL_ID` views. Requesting `execution` controls whether the compiled program runs; assembly is returned by the same compile request.
- `output-position`: `below`, `side`, or `custom`. Custom suppresses built-in output rendering.
- `live`: enable live output with a 500 ms debounce, or set the debounce as milliseconds.
- `readonly`: prevent reader edits. It has no reader-facing toggle.
- `inline`: transparent, automatically sized, read-only presentation with Monaco/clangd support. The shorter `<cb>code</cb>` tag is equivalent to an inline, read-only `<codeblock>`.
- `simple`: keep the simple editor/highlighter and never initialize Monaco or clangd. It works on both `<codeblock>` and `<cb>`.
- `src`: load source from a same-origin or CORS-enabled URL.
- `range="START[:COLUMN]-END[:COLUMN]"`: show only a source window while compiling the complete file. Columns follow C++ source-range semantics: the start is included and the end is excluded. The equivalent `start-line`, `end-line`, `start-column`, and `end-column` attributes are also available. Ranged views are read-only.
- `highlight-lines="2-4,7"`: persistently highlight source lines. Line numbers refer to the complete source file and are translated into a visible `range` automatically.
- `fit`, `fit="height"`, or `fit="width"`: fit the editor to its content in both dimensions or one dimension.
- `multi-file`: compile the active tab with the remaining tabs as extra files. `build-system="cmake"` uses the CMake API and treats `CMakeLists.txt` as the project source.
- `editable-options`: show the reader-editable compiler and execution settings, or name a comma-separated subset. Result views are selected by the output tabs; the legacy `output` field is only shown when named explicitly.
- `hide-toolbar`, `hide-tabs`, `hide-run`, `hide-compiler-explorer`, `hide-info`, and `hide-output`: author-only UI visibility controls. Corresponding `show-*` attributes override configured defaults.
- `compiler-explorer-link`: replace the generated Compiler Explorer destination with an author-provided URL. JavaScript consumers use `compilerExplorerLinkUrl`.
- `info-name`, `info-description`, and `source-url`: customize the information popover.
- `editor-options` and `styles`: JSON objects matching the JavaScript options.
- `no-render-output`: send results only to the JavaScript callback/API.
- `ce-url`: Compiler Explorer base URL, defaulting to `https://godbolt.org/`.
- `ce-language`: language stored in the Compiler Explorer client state, defaulting to `c++`.
- `ce-compiler`: legacy fallback for the compiler when `compiler` is absent.
- `ce-options`: legacy fallback for arguments when `compiler-args` is absent.
- `ce-libs`, `ce-special-outputs`, `ce-tools`, and `ce-overrides`: JSON values forwarded to Compiler Explorer.
- `ce-filters`: JSON object overriding Compiler Explorer output filters, such as `'{"intel":false,"demangle":true}'`.
- `theme`: `auto`, `light`, or `dark`.
- `debug`: log editor and clangd lifecycle details to the console.
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
for later blocks. Configuration includes `theme`, `showDebugControls`,
`language`, `compiler`, `compiler_args`, `run_args`, `stdin`, `readOnly`,
`inline`, `simple`, `fit`, `outputViews`, `outputPosition`, `live`, `ui`,
`editableOptions`, `info`, `compilerExplorer`, `compilerExplorerLinkUrl`, `editorOptions`, `styles`,
`renderOutput`, `onResult`, and `onStatus`.

The Compiler Explorer link contains the active source, filename, compiler,
arguments, execution view, and output filters in its `/clientstate/` URL. No
upload or short-link request is needed. Additional client-state fields can be
configured globally or when creating an individual block. The nested
`compiler` and `options` values are fallbacks; the code box's top-level
`compiler` and `compiler_args` always win so the action and link cannot diverge:

```js
CodeBlocks.configure({
  language: "c++",
  compiler: "gsnapshot",
  compiler_args: "-std=c++26 -O2",
  run_args: "--verbose",
  stdin: "example input\n",
  compilerExplorer: {
    baseUrl: "https://godbolt.org/",
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

The module also exports `listCompilerExplorerLanguages`,
`listCompilerExplorerCompilers`, `listCompilerExplorerLibraries`, and
`listCompilerExplorerTools`. Compiler fields use the language-specific endpoint
to offer current compiler IDs while still accepting custom/private-service IDs.
`compilerExplorer` and `editorOptions` are passed through as the consumer-facing
escape hatches for Compiler Explorer filters/tools/libraries and Monaco options.

The legacy `compilerExplorerUrl` JavaScript option remains available as an alias for `compilerExplorer.baseUrl`.

`CodeBlocks.get(element)` returns the upgraded block instance. It exposes
`getValue`, `setValue`, `getTabs`, `selectTab`, `getCompilerExplorerUrl`,
`focus`, `compile`, `run`, `setOutputView`, `setEditorMode`, `setTheme`, `dispose`, `onDidChange`, `editorReady`,
`monacoReady`, `clangdReady`, and `sourceReady`. `getValue` and `setValue` act on the active
tab. `monacoReady` resolves to the underlying Monaco standalone editor for
integrations that need the native editor API.

`CodeBlocks.setEditorMode("full" | "simple", root?)` and
`CodeBlocks.setTheme("auto" | "light" | "dark", root?)` update every existing
block under a page or container. The Pages examples use these for global
controls instead of placing editor/theme switches inside every block.

`compile()` is the presentation-independent path: it returns the structured
Compiler Explorer JSON result, including execution output and assembly. Set
`renderOutput: false` to suppress the built-in drawer, and use `onResult` to
observe results produced by either `compile()` or the Run button. The exported
`compileWithCompilerExplorer(request)` function is available for consumers that
do not need a code-block UI at all.

The requested output determines the work: an `execution` view runs the program,
while assembly, diagnostics, and tools use compilation only. Side output is
height-constrained to the editor and scrolls independently. Compiler diagnostics
are hidden when a successful compile produced none, and execution output reports
the process exit code. `outputPosition: "custom"` or `renderOutput: false`
leaves presentation to `onResult` or the returned `CompilationResult`.

The first source line may be a runline such as
`// clang2110 -std=c++23 -O2`. The compiler and remaining text become defaults
unless attributes or JavaScript options override them; the runline is removed
from the editor, compile request, and Compiler Explorer link.

Source-bearing custom elements in formatted HTML should have a
`<!-- prettier-ignore -->` comment immediately before the `<codeblock>` node.
The bundled examples do this so Prettier formats the surrounding page without
rewriting code text nodes. Runtime extraction also removes the common host-HTML
indent while retaining indentation inside the source itself.

Blocks outside an 800px viewport margin keep the simple editor until
they approach the viewport. Set `deferMonaco: false` or add `eager` when an
off-screen integration must initialize immediately. Simultaneously visible
blocks need separate Monaco renderers, but they still share the expensive VS
Code services and clangd process. If Monaco cannot start, the block remains a
functional simple editor. Failed or interrupted Monaco startup is not retried
in the same tab session; clangd is disabled after two failed or interrupted
startup attempts.

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

The lower-level ES module entries remain available as `editor.js`, `simple.js`,
and `ansi.js`. The simple-editor implementation and its language adapter live
together under `editor/simple/`. [Microlighter](https://github.com/davatron5000/microlighter)
loads the selected TextMate grammar on demand and keeps the code DOM as plain text.

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

That opt-in registers a host-owned service worker and reloads at most once. If
isolation is still unavailable, the page continues without clangd. Do not use
the attribute when the server already sends the headers.

WebAssembly threads, service workers, and cross-origin isolation require a secure context. Enable "Enforce HTTPS" for a GitHub Pages custom domain. When the isolation helper is enabled, the loader also redirects non-local HTTP pages to the same HTTPS URL as a fallback. The included `clangd.cpp.social` example redirects before loading its external CSS or JavaScript.

If assets are hosted on another origin, that origin must allow CORS and send `Cross-Origin-Resource-Policy: cross-origin` or an equivalent policy accepted by the embedding page.

## Build and test

Installing dependencies downloads the latest verified prebuilt clangd artifacts
into `public/wasm` and builds the self-contained distribution. Front-end changes
do not rebuild LLVM or clangd.

```bash
pnpm install
pnpm dev
```

`pnpm dev` performs an initial production-equivalent build, watches source and
types, and serves the same site published to Pages at `http://localhost:4173/`.
The complete examples are at `http://localhost:4173/examples/`.

The default checks are fully headless and require no browser:

```bash
pnpm test
pnpm lint
pnpm build
```

CI runs unit tests, TypeScript, Prettier verification, and the production build
for pull requests and pushes to `main` or `master`.

The heavyweight LLVM/clangd build recipe and its required source patch live in
`scripts/clangd/`. Front-end work normally uses released artifacts. To build
clangd itself, run `scripts/clangd/build.sh`; to install a local artifact set,
run `scripts/clangd/install-artifacts.sh PATH`.

The TypeScript source is split by responsibility: `codeblocks/` owns UI
orchestration, `compiler-explorer/` owns the headless API and link state,
`editor/` contains simple, language-highlighting, and Monaco adapters, and
`clangd/` owns the WebAssembly worker transport. Files at
the top of `src/` are stable public build entrypoints.

Language support is deliberately layered. The simple highlighter accepts a
language ID and loads its grammar, Monaco accepts the corresponding model
language plus consumer options, and Compiler Explorer discovery/compilation is
language-driven. C and C++ have maintained compiler defaults; other languages
(including Python) require an explicit compiler or runline until a stable
project default is chosen. New tools can be requested through `ce-tools` or the
headless API without coupling them to clangd. Additional WASM language services
can later be added beside `clangd/` without changing the code-block/Compiler
Explorer model.

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
