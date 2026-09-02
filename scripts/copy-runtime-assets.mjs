import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const source = new URL("public/wasm/", root);
const arguments_ = new Set(process.argv.slice(2));
const outdirArgument = process.argv
  .slice(2)
  .find((value) => value.startsWith("--outdir="));
const outdir = outdirArgument?.slice("--outdir=".length) ?? "dist";
const includeWasm = !arguments_.has("--without-wasm");
const destination = new URL(`${outdir}/wasm/`, root);

if (includeWasm) {
  for (const name of ["clangd.js", "clangd.wasm"]) {
    if (!existsSync(new URL(name, source))) {
      throw new Error(
        `Missing public/wasm/${name}. Run scripts/install-clangd-artifacts first.`,
      );
    }
  }
  await mkdir(destination, { recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: (path) => !path.endsWith(".gitignore"),
  });
}

await cp(new URL("public/_headers", root), new URL(`${outdir}/_headers`, root));

await cp(
  new URL("public/codeblocks.js", root),
  new URL(`${outdir}/codeblocks.js`, root),
);
await cp(
  new URL("public/coi-serviceworker.js", root),
  new URL(`${outdir}/coi-serviceworker.js`, root),
);
await cp(
  new URL("src/loader-api.d.ts", root),
  new URL(`${outdir}/loader.d.ts`, root),
);
