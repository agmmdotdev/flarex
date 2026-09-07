import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    conditions: ["source"],
    alias: [
      {
        find: "cloudflare:workers",
        replacement: fileURLToPath(
          new URL(
            "../persistence-postgres/test/cloudflareWorkersStub.ts",
            import.meta.url,
          ),
        ),
      },
    ],
  },
  test: {
    include: [
      "../medusa-drizzle/test/schema.test.ts",
      "test/product-schema.test.ts",
      "test/product-installation.test.ts",
    ],
    maxWorkers: 1,
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 120000,
  },
});
