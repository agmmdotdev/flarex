import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-tax-region-source-provenance.ts"],
    include: [
      "test/native-tax-region-source-provenance.proof.ts",
      "test/logical-tax-region-create-workflow.test.ts",
    ],
  },
});
