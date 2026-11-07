import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-shipping-option-update-source-provenance.ts"],
    include: [
      "test/native-shipping-option-update-source-provenance.proof.ts",
      "test/native-update-statements.test.ts",
      "test/shared-graph.test.ts",
      "test/core-shipping-option-update-workflow.test.ts",
    ],
  },
});
