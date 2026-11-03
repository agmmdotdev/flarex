import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-api-key-source-provenance.ts"],
    include: [
      "test/native-api-key-source-provenance.proof.ts",
      "test/logical-api-key-creation-workflow.test.ts",
      "test/logical-api-key-lifecycle-workflow.test.ts",
      "test/logical-api-key-deletion-workflow.test.ts",
      "test/logical-api-key-association-workflow.test.ts",
    ],
  },
});
