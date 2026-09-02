import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  projectDescendant,
  projectRoot,
  readProjectPackage,
} from "./lib/project.mjs";

const [source, destination, name] = process.argv.slice(2);
if (!source || !destination || !name) {
  throw new Error(
    "Usage: prepare-npm-package.mjs SOURCE DESTINATION PACKAGE_NAME",
  );
}

const sourceDirectory = projectDescendant(source, "source directory");
const destinationDirectory = projectDescendant(destination, "package directory");
const project = await readProjectPackage();

await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });
await cp(sourceDirectory, destinationDirectory, {
  recursive: true,
  filter: (file) => !/[\\/]index\.html$|[\\/]_headers$/.test(file),
});

for (const file of ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  await cp(
    path.join(projectRoot, file),
    path.join(destinationDirectory, file),
  );
}

await writeFile(
  path.join(destinationDirectory, "package.json"),
  `${JSON.stringify(
    {
      name,
      version: project.version,
      description: project.description,
      license: project.license,
      repository: project.repository,
      publishConfig: {
        access: "public",
      },
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
