import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const NOTIFICATION_INTEGRATION_TIMEOUT = 30_000

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
  hookTimeout: NOTIFICATION_INTEGRATION_TIMEOUT,
  include: [
    "integration-tests/__tests__/notification-module-service/index.spec.ts",
    "integration-tests/__tests__/notification-module-service/medusa-cloud-email.spec.ts",
  ],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: NOTIFICATION_INTEGRATION_TIMEOUT,
})
