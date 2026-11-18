import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-shipping-option-type-source-provenance.ts"],
    include: [
      "test/native-shipping-option-type-source-provenance.proof.ts",
      "test/logical-shipping-option-type-creation-workflow.test.ts",
      "test/logical-shipping-option-type-update-workflow.test.ts",
      "test/logical-shipping-option-type-deletion-workflow.test.ts",
    ],
  },
});
