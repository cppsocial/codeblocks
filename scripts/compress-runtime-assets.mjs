import { brotliCompress } from "node:zlib";
import { promisify } from "node:util";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants as zlibConstants } from "node:zlib";
import { parseArguments, projectChild } from "./lib/project.mjs";

const compress = promisify(brotliCompress);
const minimumJavaScriptSize = 128 * 1024;
const { options } = parseArguments();
const outdir = options.get("outdir") ?? "dist";
const outputDirectory = projectChild(outdir, "output directory");

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(filename);
      if (!entry.isFile() || filename.endsWith(".br")) return;

      const isWasm = filename.endsWith(".wasm");
      const isJavaScript = filename.endsWith(".js");
      if (!isWasm && !isJavaScript) return;

      const contents = await readFile(filename);
      const relativePath = path.relative(outputDirectory, filename);
      const isWasmRuntime = relativePath.split(path.sep)[0] === "wasm";
      if (
        isJavaScript &&
        !isWasmRuntime &&
        contents.length < minimumJavaScriptSize
      )
        return;

      const compressed = await compress(contents, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
          [zlibConstants.BROTLI_PARAM_MODE]: isWasm
            ? zlibConstants.BROTLI_MODE_GENERIC
            : zlibConstants.BROTLI_MODE_TEXT,
        },
      });
      await writeFile(`${filename}.br`, compressed);
    }),
  );
}

await visit(outputDirectory);
