import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const FULFILLMENT_INTEGRATION_TIMEOUT = 1_000_000

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
  hookTimeout: FULFILLMENT_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/fulfillment-module-service/fulfillment-set.spec.ts",
    "integration-tests/__tests__/fulfillment-module-service/fulfillment.spec.ts",
    "integration-tests/__tests__/fulfillment-module-service/geo-zone.spec.ts",
    "integration-tests/__tests__/fulfillment-module-service/index.spec.ts",
    "integration-tests/__tests__/fulfillment-module-service/service-zone.spec.ts",
    "integration-tests/__tests__/fulfillment-module-service/shipping-option.spec.ts",
    "integration-tests/__tests__/fulfillment-module-service/shipping-profile.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: FULFILLMENT_INTEGRATION_TIMEOUT,
})
