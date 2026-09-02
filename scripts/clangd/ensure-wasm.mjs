import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot, readProjectPackage } from "../lib/project.mjs";

const root = projectRoot;
const wasmDirectory = path.join(root, "public", "wasm");
const wasmFiles = ["clangd.js", "clangd.wasm"];

async function isNonEmptyFile(file) {
  try {
    return (await stat(file)).size > 0;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const haveAllArtifacts = (
  await Promise.all(
    wasmFiles.map((name) => isNonEmptyFile(path.join(wasmDirectory, name))),
  )
).every(Boolean);

if (haveAllArtifacts) {
  console.log("Using existing clangd WebAssembly artifacts.");
  process.exit(0);
}

const project = await readProjectPackage();

function githubRepositoryFromUrl(url) {
  if (typeof url !== "string") {
    return undefined;
  }

  const match = url.match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/);

  if (!match) {
    return undefined;
  }

  return `${match[1]}/${match[2]}`;
}

const releaseRepository =
  process.env.RELEASE_REPOSITORY ??
  githubRepositoryFromUrl(project.repository?.url);

if (!releaseRepository) {
  throw new Error(
    "Could not determine the GitHub repository containing clangd WASM releases.",
  );
}

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "cppsocial-codeblocks",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

async function getReleases() {
  const releases = [];

  for (let page = 1; ; ++page) {
    const url =
      `https://api.github.com/repos/${releaseRepository}/releases` +
      `?per_page=100&page=${page}`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(
        `GitHub releases request failed: ` +
          `${response.status} ${response.statusText}`,
      );
    }

    const batch = await response.json();
    releases.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  return releases;
}

const releases = await getReleases();

const release = releases
  .filter(
    (candidate) =>
      !candidate.draft &&
      candidate.tag_name?.startsWith("clangd-wasm/") &&
      candidate.published_at,
  )
  .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))
  .at(-1);

if (!release) {
  throw new Error(
    `No published clangd-wasm/* release found in ${releaseRepository}.`,
  );
}

const assets = new Map(release.assets.map((asset) => [asset.name, asset]));

for (const name of [...wasmFiles, "SHA256SUMS"]) {
  if (!assets.has(name)) {
    throw new Error(`Release ${release.tag_name} is missing ${name}.`);
  }
}

async function download(name) {
  const asset = assets.get(name);
  const response = await fetch(asset.browser_download_url, {
    headers: {
      "User-Agent": "cppsocial-codeblocks",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Downloading ${name} failed: ` +
        `${response.status} ${response.statusText}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

console.log(
  `Downloading clangd WebAssembly artifacts from ${release.tag_name}.`,
);

const checksumFile = (await download("SHA256SUMS")).toString("utf8");

const checksums = new Map();

for (const line of checksumFile.split("\n")) {
  const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/);

  if (match) {
    checksums.set(path.basename(match[2]), match[1].toLowerCase());
  }
}

const downloads = new Map();

for (const name of wasmFiles) {
  const expected = checksums.get(name);

  if (!expected) {
    throw new Error(`SHA256SUMS does not contain ${name}.`);
  }

  const contents = await download(name);
  const actual = createHash("sha256").update(contents).digest("hex");

  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${name}: ` +
        `expected ${expected}, got ${actual}.`,
    );
  }

  downloads.set(name, contents);
}

await mkdir(wasmDirectory, { recursive: true });

for (const [name, contents] of downloads) {
  await writeFile(path.join(wasmDirectory, name), contents);
}

console.log(`Installed clangd WebAssembly artifacts from ${release.tag_name}.`);
