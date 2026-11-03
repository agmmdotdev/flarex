import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-order-change-source-provenance.ts"],
    include: [
      "test/native-order-change-source-provenance.proof.ts",
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
