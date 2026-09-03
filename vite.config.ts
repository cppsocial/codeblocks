import { defineConfig } from "vite";
import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";

const crossOriginIsolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export default defineConfig({
  base: "./",
  define: {
    __CLANGD_WASM_BASE__: JSON.stringify(process.env.CLANGD_WASM_BASE ?? ""),
  },
  publicDir: false,
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  build: {
    target: "es2022",
    cssCodeSplit: false,
    lib: {
      entry: {
        editor: "src/runtime.ts",
        simple: "src/simple.ts",
        ansi: "src/ansi.ts",
        "codeblocks-module": "src/codeblocks-entry.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: "codeblocks",
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css")
            ? "codeblocks.css"
            : "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      tsconfig: "./tsconfig.json",
      plugins: [importMetaUrlPlugin],
    },
  },
  worker: {
    format: "es",
  },
  resolve: {
    dedupe: ["monaco-editor", "vscode"],
  },
});
