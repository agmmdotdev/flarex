import { fileURLToPath } from "node:url"

import { defineNodeVitestConfig } from "./define-node-vitest-config"

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))

export default defineNodeVitestConfig({
  aliases: [],
  include: [
    "scripts/test-runner/contracts/node-vitest-foundation.vitest.spec.ts",
  ],
  legacyJestBridge: true,
  root: repositoryRoot,
})
