import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const PAYMENT_INTEGRATION_TIMEOUT = 30_000

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
  hookTimeout: PAYMENT_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/loaders/providers.spec.ts",
    "integration-tests/__tests__/services/payment-module/index.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: PAYMENT_INTEGRATION_TIMEOUT,
})
