import { fileURLToPath } from "node:url";
import { runFlarexDevCli } from "flarex-dev/cli";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

process.exitCode = await runFlarexDevCli({
  argv: [
    "codegen",
    "--typecheck",
    "enable",
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
