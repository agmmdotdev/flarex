import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-payment-finance-source-provenance.ts"],
    include: [
      "test/native-payment-finance-source-provenance.proof.ts",
      "test/logical-payment-finance-workflows.test.ts",
      "test/logical-payment-single-refund-workflow.test.ts",
      "test/logical-payment-lifecycle-workflows.test.ts",
      "test/logical-checkout-native-steps.test.ts",
      "test/logical-checkout-exact-refund.test.ts",
      "test/logical-order-payment-collection-read.test.ts",
    ],
  },
});
