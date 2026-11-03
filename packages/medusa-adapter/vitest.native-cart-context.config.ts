import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-cart-context-source-provenance.ts"],
    include: [
      "test/native-cart-context-source-provenance.proof.ts",
      "test/logical-cart-context-read-workflow.test.ts",
    ],
  },
});
