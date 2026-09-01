import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const PRICING_INTEGRATION_TIMEOUT = 30_000

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
  hookTimeout: PRICING_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/services/pricing-module/calculate-price.spec.ts",
    "integration-tests/__tests__/services/pricing-module/index.spec.ts",
    "integration-tests/__tests__/services/pricing-module/price-list-rule.spec.ts",
    "integration-tests/__tests__/services/pricing-module/price-list.spec.ts",
    "integration-tests/__tests__/services/pricing-module/price-rule.spec.ts",
    "integration-tests/__tests__/services/pricing-module/price-set.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: PRICING_INTEGRATION_TIMEOUT,
})
