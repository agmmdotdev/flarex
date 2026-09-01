import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const ORDER_INTEGRATION_TIMEOUT = 1_000_000

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
  hookTimeout: ORDER_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/create-order.spec.ts",
    "integration-tests/__tests__/delete-order.spec.ts",
    "integration-tests/__tests__/index.spec.ts",
    "integration-tests/__tests__/order-claim.spec.ts",
    "integration-tests/__tests__/order-edit.spec.ts",
    "integration-tests/__tests__/order-exchange.spec.ts",
    "integration-tests/__tests__/order-items-shipping.spec.ts",
    "integration-tests/__tests__/order-return.spec.ts",
    "integration-tests/__tests__/returns.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: ORDER_INTEGRATION_TIMEOUT,
})
