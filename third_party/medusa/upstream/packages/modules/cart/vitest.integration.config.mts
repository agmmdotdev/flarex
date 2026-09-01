import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const CART_INTEGRATION_TIMEOUT = 50_000

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
  ],
  hookTimeout: CART_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/services/cart-module/index.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: CART_INTEGRATION_TIMEOUT,
})
