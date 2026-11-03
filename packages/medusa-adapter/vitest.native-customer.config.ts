import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-customer-source-provenance.ts"],
    include: [
      "test/native-customer-source-provenance.proof.ts",
      "test/logical-customer-selection-workflow.test.ts",
      "test/logical-customer-cart-creation-read.test.ts",
    ],
  },
});
