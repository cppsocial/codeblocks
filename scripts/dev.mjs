import { spawn, spawnSync } from "node:child_process";

const initial = spawnSync("pnpm", ["build"], { stdio: "inherit" });
if (initial.status !== 0) process.exit(initial.status ?? 1);

const processes = [
  spawn("pnpm", ["exec", "vite", "build", "--watch", "--emptyOutDir=false"], {
    stdio: "inherit",
  }),
  spawn("pnpm", ["exec", "tsc", "--watch", "--preserveWatchOutput"], {
    stdio: "inherit",
  }),
  spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--strictPort",
      "--outDir",
      "dist",
    ],
    { stdio: "inherit" },
  ),
];

const stop = (signal) => {
  for (const process of processes) process.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
await Promise.race(
  processes.map(
    (process) => new Promise((resolve) => process.once("exit", resolve)),
  ),
);
stop("SIGTERM");
