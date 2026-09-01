import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))
const FILE_INTEGRATION_TIMEOUT = 100_000

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
  hookTimeout: FILE_INTEGRATION_TIMEOUT,
  include: ["integration-tests/__tests__/module.spec.ts"],
  legacyJestBridge: false,
  root: packageRoot,
  testTimeout: FILE_INTEGRATION_TIMEOUT,
})
