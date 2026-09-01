import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineNodeVitestIntegrationConfig({
  aliases: [],
  include: [
    "src/__tests__/module-test-persistence-selection.spec.ts",
    "src/__tests__/pglite-module-test-persistence-adapter.spec.ts",
    "test-runner-contracts/module-test-runner-lifecycle.spec.ts",
  ],
  root: packageRoot,
})
