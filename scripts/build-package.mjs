import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  parseArguments,
  projectChild,
  projectRoot,
  run,
  runProjectExecutable,
} from "./lib/project.mjs";

const { flags, options } = parseArguments();
const outdir = options.get("outdir") ?? "dist";
const outputDirectory = projectChild(outdir, "output directory");

await rm(outputDirectory, { recursive: true, force: true });

if (flags.has("--clean")) {
  process.exit(0);
}

await runProjectExecutable("tsc", []);
await runProjectExecutable("vite", [
  "build",
  "--outDir",
  outdir,
  "--emptyOutDir",
]);
await runProjectExecutable("tsc", [
  "-p",
  "tsconfig.types.json",
  "--outDir",
  `${outdir}/types`,
]);

const assetArguments = [`--outdir=${outdir}`];
if (flags.has("--without-wasm")) {
  assetArguments.push("--without-wasm");
}

await run(
  process.execPath,
  [path.join(projectRoot, "scripts", "copy-runtime-assets.mjs"), ...assetArguments],
  { label: "copy-runtime-assets" },
);
