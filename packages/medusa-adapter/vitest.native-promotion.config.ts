import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-promotion-source-provenance.ts"],
    include: [
      "test/native-promotion-source-provenance.proof.ts",
      "test/logical-promotion-prefilter.test.ts",
      "test/logical-native-promotion-compute.test.ts",
    ],
  },
});
