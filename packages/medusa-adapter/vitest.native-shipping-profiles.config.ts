import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-shipping-profile-source-provenance.ts"],
    include: [
      "test/native-shipping-profile-source-provenance.proof.ts",
      "test/logical-shipping-profile-creation-workflow.test.ts",
      "test/logical-shipping-profile-update-workflow.test.ts",
      "test/logical-shipping-profile-deletion-workflow.test.ts",
    ],
  },
});
