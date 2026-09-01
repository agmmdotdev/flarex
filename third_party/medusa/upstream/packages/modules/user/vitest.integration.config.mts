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
    {
      find: "@utils",
      replacement: "src/utils",
    },
  ],
  include: [
    "integration-tests/__tests__/invite.spec.ts",
    "integration-tests/__tests__/user.spec.ts",
  ],
  root: packageRoot,
})
