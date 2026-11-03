import { Schema } from "effect";
import { defineConfig } from "vitest/config";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(
  process.env.FLAREX_TEST_DRIVER ?? "pglite",
);

export default defineConfig({
  resolve: { conditions: ["source", "module", "node", "development"] },
  ssr: {
    noExternal: [/^@medusajs\//],
    resolve: { conditions: ["source", "module", "node", "development"] },
  },
  test: {
    environment: "node",
    maxWorkers: 1,
    fileParallelism: false,
    env: { FLAREX_TEST_DRIVER: driver, MEDUSA_COMPARISON_DRIVER: driver },
    globalSetup: ["./test/support/native-stock-sales-source-provenance.ts"],
    server: { deps: { inline: [/^@medusajs\//] } },
    include: [
      "test/native-stock-sales-source-provenance.proof.ts",
      "test/logical-stock-location-create-identities.test.ts",
      "test/logical-stock-location-update-workflow.test.ts",
      "test/logical-stock-location-one-to-one.test.ts",
      "test/logical-stock-location-deletion-workflow.test.ts",
      "test/logical-stock-location-read-results.test.ts",
      "test/logical-sales-channel-storage.test.ts",
      "test/logical-sales-channel-native-atomic-admission.test.ts",
      "test/logical-sales-channel-creation-workflow.test.ts",
      "test/logical-sales-channel-update-workflow.test.ts",
      "test/logical-sales-channel-deletion-workflow.test.ts",
      "test/logical-sales-channel-location-workflow.test.ts",
      "test/logical-product-sales-channel-link.test.ts",
      "test/logical-product-sales-channel-workflow.test.ts",
      "test/logical-product-sales-channel-membership-workflow.test.ts",
      "test/logical-location-fulfillment-set-creation-workflow.test.ts",
      "test/logical-fulfillment-set-deletion-workflow.test.ts",
    ],
    hookTimeout: 300_000,
    testTimeout: 180_000,
  },
});
