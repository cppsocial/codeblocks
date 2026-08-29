import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const source = new URL("public/wasm/", root);
const destination = new URL("dist/wasm/", root);

for (const name of ["clangd.js", "clangd.wasm"]) {
  if (!existsSync(new URL(name, source))) {
    throw new Error(
      `Missing public/wasm/${name}. Run scripts/install-clangd-artifacts first.`,
    );
  }
}

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, filter: (path) => !path.endsWith(".gitignore") });
await cp(new URL("public/_headers", root), new URL("dist/_headers", root));
