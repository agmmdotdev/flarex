import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-cart-payment-collection-source-provenance.ts"],
    include: [
      "test/native-cart-payment-collection-source-provenance.proof.ts",
      "test/logical-cart-payment-collection-core.test.ts",
    ],
  },
});
