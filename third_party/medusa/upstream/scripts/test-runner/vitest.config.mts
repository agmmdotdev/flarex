import { fileURLToPath } from "node:url"

import { defineNodeVitestConfig } from "./define-node-vitest-config"

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))

export default defineNodeVitestConfig({
  aliases: [
    {
      find: "@contract-services",
      replacement: "scripts/test-runner/contracts/fixtures/aliases/services",
    },
    {
      find: "@contract-services-other",
      replacement:
        "scripts/test-runner/contracts/fixtures/aliases/services-other.ts",
    },
  ],
  exclude: ["**/*.vitest.spec.ts"],
  include: [
    "scripts/test-runner/contracts/__tests__/**/*.{js,ts}",
    "scripts/test-runner/contracts/**/*.{spec,test}.{js,ts}",
    "packages/core/utils/src/dal/mikro-orm/__tests__/big-number-field.spec.ts",
    "packages/core/utils/src/modules-sdk/decorators/__tests__/emit-events.ts",
  ],
  legacyJestBridge: true,
  root: repositoryRoot,
})
