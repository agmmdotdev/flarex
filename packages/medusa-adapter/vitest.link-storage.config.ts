import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { conditions: ["source"], alias: [{ find: "cloudflare:workers", replacement: fileURLToPath(new URL("../persistence-postgres/test/cloudflareWorkersStub.ts", import.meta.url)) }] },
  test: { globals: false, maxWorkers: 1, fileParallelism: false,
    include: ["test/link-storage.test.ts"], hookTimeout: 120000, testTimeout: 100000 },
});
