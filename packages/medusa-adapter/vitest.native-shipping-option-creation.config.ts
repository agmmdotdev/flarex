import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-shipping-option-creation-source-provenance.ts"],
    include: [
      "test/native-shipping-option-creation-source-provenance.proof.ts",
      "test/logical-shipping-option-creation-workflow.test.ts",
    ],
  },
});
