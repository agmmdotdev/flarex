import { fileURLToPath } from "node:url"

import { defineNodeVitestIntegrationConfig } from "../../../scripts/test-runner/define-node-vitest-integration-config"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

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
  include: [
    "integration-tests/__tests__/auth-module-service/auth-identity.spec.ts",
    "integration-tests/__tests__/auth-module-service/index.spec.ts",
    "integration-tests/__tests__/auth-module-service/medusa-cloud-auth.spec.ts",
  ],
  root: packageRoot,
})
