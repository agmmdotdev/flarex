import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: [
      "./test/support/native-order-source-provenance.ts",
      "./test/support/native-cart-source-provenance.ts",
    ],
    include: [
      "test/native-order-source-provenance.proof.ts",
      "test/logical-order-creation-consumer.test.ts",
      "test/logical-order-generated-serial.test.ts",
      "test/logical-order-checkout-admission.test.ts",
      "test/checkout-address-native-prerequisite.test.ts",
      "test/core-order-checkout-retained.test.ts",
      "test/native-cart-source-provenance.proof.ts",
      "test/logical-cart-completion-workflow.test.ts",
      "test/logical-checkout-line-price.test.ts",
      "test/logical-order-archive-workflow.test.ts",
      "test/logical-order-complete-workflow.test.ts",
      "test/order-archive-receipts.test.ts",
      "test/order-completion-receipts.test.ts",
      "test/logical-order-change-update-workflow.test.ts",
      "test/logical-order-change-cancellation-workflow.test.ts",
      "test/logical-order-change-decline-workflow.test.ts",
      "test/logical-order-change-deletion-workflow.test.ts",
      "test/order-change-update-receipts.test.ts",
      "test/order-change-cancellation-receipts.test.ts",
      "test/order-change-decline-receipts.test.ts",
      "test/order-change-deletion-receipts.test.ts",
    ],
  },
});
