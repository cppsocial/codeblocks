import { defineConfig } from "vite";
import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";
import { existsSync } from "node:fs";
import path from "node:path";

const crossOriginIsolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const contentTypes = new Map([
  [".js", "text/javascript"],
  [".wasm", "application/wasm"],
]);

function precompressedPreview() {
  return {
    name: "precompressed-preview",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (
          !request.url ||
          !/\bbr\b/.test(request.headers["accept-encoding"] ?? "")
        ) {
          return next();
        }

        const pathname = decodeURIComponent(
          new URL(request.url, "http://localhost").pathname,
        );
        const extension = path.extname(pathname);
        const contentType = contentTypes.get(extension);
        if (!contentType) return next();

        const relativePath = pathname.replace(/^\/+/, "");
        const candidate = path.resolve(
          server.config.root,
          server.config.build.outDir,
          `${relativePath}.br`,
        );
        const outputRoot = path.resolve(
          server.config.root,
          server.config.build.outDir,
        );
        if (
          !candidate.startsWith(`${outputRoot}${path.sep}`) ||
          !existsSync(candidate)
        ) {
          return next();
        }

        request.url = `${pathname}.br`;
        response.setHeader("Content-Encoding", "br");
        response.setHeader("Content-Type", contentType);
        response.setHeader("Vary", "Accept-Encoding");
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [precompressedPreview()],
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
