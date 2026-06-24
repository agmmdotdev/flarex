import { fileURLToPath } from "node:url";
import { runFlarexDevCli } from "flarex-dev/cli";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

process.exitCode = await runFlarexDevCli({
  argv: [
    "codegen",
    "--root",
    root,
    "--typecheck",
    "--cwd",
    workspaceRoot,
    "--typescript-cli",
    "node_modules/typescript/bin/tsc",
    "--path",
    "flarex=packages/flarex/src/index.ts",
    "--path",
    "flarex/*=packages/flarex/src/*",
  ],
});
