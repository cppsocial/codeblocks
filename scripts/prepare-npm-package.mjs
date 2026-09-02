import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const [source, destination, name] = process.argv.slice(2);
if (!source || !destination || !name) {
  throw new Error(
    "Usage: prepare-npm-package.mjs SOURCE DESTINATION PACKAGE_NAME",
  );
}

const root = path.resolve(import.meta.dirname, "..");
const sourceDirectory = path.resolve(root, source);
const destinationDirectory = path.resolve(root, destination);
const project = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });
await cp(sourceDirectory, destinationDirectory, {
  recursive: true,
  filter: (file) => !/[\\/]index\.html$|[\\/]_headers$/.test(file),
});
const declaration = path.join(destinationDirectory, "types", "codeblocks.d.ts");
await writeFile(
  declaration,
  (await readFile(declaration, "utf8")).replace(
    'import "./codeblocks.css";\n',
    "",
  ),
);
await writeFile(
  path.join(destinationDirectory, "package.json"),
  `${JSON.stringify(
    {
      name,
      version: project.version,
      description: project.description,
      license: project.license,
      type: "module",
      files: ["**/*"],
      exports: {
        ".": {
          types: "./types/codeblocks.d.ts",
          import: "./codeblocks-module.js",
        },
        "./loader": {
          types: "./loader.d.ts",
          default: "./codeblocks.js",
        },
        "./styles.css": "./codeblocks.css",
      },
    },
    null,
    2,
  )}\n`,
);
