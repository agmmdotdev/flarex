import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["source", "module", "node", "development"] },
  ssr: { noExternal: [/^@medusajs\//], resolve: { conditions: ["source", "module", "node", "development"] } },
  test: { maxWorkers: 1, fileParallelism: false,
    server: { deps: { inline: [/^@medusajs\//] } },
    include: ["test/durable-native-storage.test.ts", "test/durable-locking.test.ts",
      "test/logical-fulfillment-delivery-workflow.test.ts"],
    hookTimeout: 300_000, testTimeout: 180_000,
  },
});
