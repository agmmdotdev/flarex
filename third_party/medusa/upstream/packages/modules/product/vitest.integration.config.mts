import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const PRODUCT_INTEGRATION_TIMEOUT = 300_000

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
  hookTimeout: PRODUCT_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/product-category.spec.ts",
    "integration-tests/__tests__/product-module-service/events.spec.ts",
    "integration-tests/__tests__/product-module-service/product-categories.spec.ts",
    "integration-tests/__tests__/product-module-service/product-collections.spec.ts",
    "integration-tests/__tests__/product-module-service/product-options.spec.ts",
    "integration-tests/__tests__/product-module-service/product-tags.spec.ts",
    "integration-tests/__tests__/product-module-service/product-types.spec.ts",
    "integration-tests/__tests__/product-module-service/product-variants.spec.ts",
    "integration-tests/__tests__/product-module-service/products.spec.ts",
    "integration-tests/__tests__/product.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: PRODUCT_INTEGRATION_TIMEOUT,
})
