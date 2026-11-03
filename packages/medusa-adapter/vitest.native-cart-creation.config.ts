import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-cart-creation-source-provenance.ts"],
    include: [
      "test/native-cart-creation-source-provenance.proof.ts",
      "test/logical-cart-create-root.test.ts",
      "test/logical-link-preimages.test.ts",
    ],
  },
});
