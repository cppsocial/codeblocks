import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const projectRoot = path.resolve(import.meta.dirname, "../..");

export function parseArguments(values = process.argv.slice(2)) {
  const flags = new Set();
  const options = new Map();
  for (const value of values) {
    const match = value.match(/^--([^=]+)=(.*)$/s);
    if (match) options.set(match[1], match[2]);
    else flags.add(value);
  }
  return { flags, options };
}

export function projectChild(value, description = "path") {
  const resolved = path.resolve(projectRoot, value);
  if (path.dirname(resolved) !== projectRoot) {
    throw new Error(`The ${description} must be directly inside the project root.`);
  }
  return resolved;
}

export function projectDescendant(value, description = "path") {
  const resolved = path.resolve(projectRoot, value);
  const relative = path.relative(projectRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`The ${description} must be inside the project root.`);
  }
  return resolved;
}

export async function readProjectPackage() {
  return JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(new Error(
          `${options.label ?? path.basename(command)} failed${
            signal ? ` with signal ${signal}` : ` with exit code ${code}`
          }.`,
        ));
      }
    });
  });
}

export function runProjectExecutable(command, args) {
  const extension = process.platform === "win32" ? ".cmd" : "";
  return run(
    path.join(projectRoot, "node_modules", ".bin", `${command}${extension}`),
    args,
    { label: command },
  );
}
