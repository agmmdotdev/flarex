import { fileURLToPath } from "node:url";
import { typecheckGeneratedOutput } from "flarex-dev";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

await typecheckGeneratedOutput({
  root,
  cwd: workspaceRoot,
  typescriptCliPath: "node_modules/typescript/bin/tsc",
  compilerOptions: {
    paths: {
      flarex: ["packages/flarex/src/index.ts"],
      "flarex/*": ["packages/flarex/src/*"],
    },
  },
});
