#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const tsxLoaderUrl = pathToFileURL(require.resolve("tsx")).href;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = resolve(packageRoot, "src/bin.ts");

const result = spawnSync(
  process.execPath,
  ["--import", tsxLoaderUrl, binPath, ...process.argv.slice(2)],
  {
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error !== undefined) {
  throw result.error;
}
if (result.signal !== null) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.status ?? 1;
}
