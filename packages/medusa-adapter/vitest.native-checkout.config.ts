import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-checkout-source-provenance.ts"],
    include: [
      "test/native-checkout-source-provenance.proof.ts",
      "test/checkout-index-requirements.test.ts",
      "test/core-native-scope-exclusion.test.ts",
      "test/logical-checkout-workflow.test.ts",
      "test/logical-checkout-inventory.test.ts",
      "test/logical-checkout-customer-address.test.ts",
      "test/logical-checkout-customer-context.test.ts",
    ],
  },
});
