import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-shipping-option-rule-source-provenance.ts"],
    include: [
      "test/native-shipping-option-rule-source-provenance.proof.ts",
      "test/logical-shipping-option-rule-batch-workflow.test.ts",
    ],
  },
});