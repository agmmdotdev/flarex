import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["source", "module", "node", "development"] },
  ssr: { noExternal: [/^@medusajs\//], resolve: { conditions: ["source", "module", "node", "development"] } },
  test: { maxWorkers: 1, fileParallelism: false,
    server: { deps: { inline: [/^@medusajs\//] } },
    include: ["test/logical-product-inline-import.test.ts", "test/logical-product-inline-import-recovery.test.ts",
      "test/product-inline-import-input.test.ts", "test/product-native-csv-admission.test.ts",
      "test/durable-native-checkpoint-profile.test.ts"],
    hookTimeout: 300_000, testTimeout: 180_000,
  },
});
