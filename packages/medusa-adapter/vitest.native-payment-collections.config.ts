import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-payment-collections-source-provenance.ts"],
    include: [
      "test/native-payment-collections-source-provenance.proof.ts",
      "test/logical-payment-session-workflows.test.ts",
      "test/logical-checkout-exact-session.test.ts",
      "test/logical-payment-collection-workflows.test.ts",
      "test/logical-payment-reliability.test.ts",
      "test/logical-atomic-stored-workflow.test.ts",
      "test/logical-callback-child-workflow.test.ts",
      "test/logical-customer-address-accounts.test.ts",
      "test/logical-customer-address-native-corrections.test.ts",
    ],
  },
});
