import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const PROMOTION_INTEGRATION_TIMEOUT = 30_000

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
  hookTimeout: PROMOTION_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/services/promotion-module/campaign.spec.ts",
    "integration-tests/__tests__/services/promotion-module/compute-actions.spec.ts",
    "integration-tests/__tests__/services/promotion-module/evaluate-rule-value-condition.spec.ts",
    "integration-tests/__tests__/services/promotion-module/promotion.spec.ts",
    "integration-tests/__tests__/services/promotion-module/register-usage.spec.ts",
    "integration-tests/__tests__/services/promotion-module/revert-usage.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: PROMOTION_INTEGRATION_TIMEOUT,
})
