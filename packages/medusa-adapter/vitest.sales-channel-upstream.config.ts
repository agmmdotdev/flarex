import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Reporter } from "vitest/node";

// Every preserved original must execute; source-port guards independently keep
// its scenario, assertion and declaration structure unchanged.
const coverage: Reporter = {
  onTestRunEnd(modules) {
    const cases = modules.flatMap(module => [...module.children.allTests()]);
    if (cases.length !== 14 || cases.some(test => test.result().state !== "passed")) throw new Error("Expected all 14 native Sales Channel cases to pass");
  },
};
export default defineConfig({
  resolve: { conditions: ["source"], alias: [
    { find: /^@medusajs\/test-utils$/, replacement: fileURLToPath(new URL("./test/support/sales-channel-runner.ts", import.meta.url)) },
    { find: /^@services$/, replacement: fileURLToPath(new URL("../medusa-sales-channel/src/services/index.ts", import.meta.url)) },
    { find: "cloudflare:workers", replacement: fileURLToPath(new URL("../persistence-postgres/test/cloudflareWorkersStub.ts", import.meta.url)) },
  ] },
  test: { globals: false, maxWorkers: 1, fileParallelism: false,
    include: ["../medusa-sales-channel/integration-tests/__tests__/services/sales-channel-module.spec.ts"],
    hookTimeout: 120000, testTimeout: 30000, reporters: ["default", coverage],
  },
});
