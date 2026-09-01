import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const TAX_INTEGRATION_TIMEOUT = 30_000

export default defineNodeVitestIntegrationConfig({
  aliases: [
    {
      find: "@models",
      replacement: "src/models",
    },
    {
      find: "@services",
      replacement: "src/services",
    },
    {
      find: "@repositories",
      replacement: "src/repositories",
    },
    {
      find: "@types",
      replacement: "src/types",
    },
    {
      find: "@utils",
      replacement: "src/utils",
    },
  ],
  hookTimeout: TAX_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/index.spec.ts",
    "integration-tests/__tests__/local-providers.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: TAX_INTEGRATION_TIMEOUT,
})
