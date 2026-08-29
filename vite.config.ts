import { defineConfig } from "vite";
import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    target: "es2022",
    cssCodeSplit: false,
    lib: {
      entry: {
        editor: "src/runtime.ts",
        fallback: "src/fallback.ts",
        ansi: "src/ansi.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: "editor",
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css")
            ? "editor.css"
            : "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
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
