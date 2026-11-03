import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

/** Reuse the actual SSR Source-resolution gate, including Store and Pricing. */
export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    include: [
      "test/native-stock-sales-source-provenance.proof.ts",
      "test/logical-store-create-workflow.test.ts",
      "test/logical-store-update-workflow.test.ts",
      "test/logical-store-deletion-workflow.test.ts",
    ],
  },
});
