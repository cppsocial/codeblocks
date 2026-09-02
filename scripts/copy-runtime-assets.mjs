import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArguments, projectChild, projectRoot } from "./lib/project.mjs";

const { flags, options } = parseArguments();
const outdir = options.get("outdir") ?? "dist";
const outputDirectory = projectChild(outdir, "output directory");
const source = path.join(projectRoot, "public", "wasm");
const includeWasm = !flags.has("--without-wasm");
const destination = path.join(outputDirectory, "wasm");

if (includeWasm) {
  for (const name of ["clangd.js", "clangd.wasm"]) {
    if (!existsSync(path.join(source, name))) {
      throw new Error(
        `Missing public/wasm/${name}. Run scripts/clangd/install-artifacts.sh first.`,
      );
    }
  }
  await mkdir(destination, { recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: (path) => !path.endsWith(".gitignore"),
  });
}

for (const [sourceFile, outputFile = sourceFile] of [
  ["public/_headers", "_headers"],
  ["public/index.html", "index.html"],
  ["public/codeblocks.js", "codeblocks.js"],
  ["public/coi-serviceworker.js", "coi-serviceworker.js"],
  ["src/loader-api.d.ts", "loader.d.ts"],
]) {
  await cp(
    path.join(projectRoot, sourceFile),
    path.join(outputDirectory, outputFile),
  );
}

await cp(
  path.join(projectRoot, "public", "examples"),
  path.join(outputDirectory, "examples"),
  { recursive: true },
);

const grammarSource = path.join(
  projectRoot,
  "node_modules",
  "microlighter",
  "dist",
  "grammars",
);
const grammarDestination = path.join(outputDirectory, "grammars");
await mkdir(grammarDestination, { recursive: true });
const grammars = (await readdir(grammarSource)).filter((name) =>
  name.endsWith(".js"),
);
await Promise.all(
  grammars.map((name) =>
    cp(path.join(grammarSource, name), path.join(grammarDestination, name)),
  ),
);
