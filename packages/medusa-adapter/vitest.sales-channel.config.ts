import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["source"], alias: [{ find: "cloudflare:workers", replacement: fileURLToPath(new URL("../persistence-postgres/test/cloudflareWorkersStub.ts", import.meta.url)) }] },
  test: { globals: false, maxWorkers: 1, fileParallelism: false,
    include: ["test/logical-sales-channel-storage.test.ts", "test/module-definition.test.ts", "../medusa-sales-channel/src/__tests__/static-manifest.spec.ts"],
    hookTimeout: 120000, testTimeout: 100000,
  },
});
