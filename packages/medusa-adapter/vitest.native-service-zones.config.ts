import { defineConfig } from "vitest/config";
import nativeStockSales from "./vitest.native-stock-sales.config.ts";

export default defineConfig({
  ...nativeStockSales,
  test: {
    ...nativeStockSales.test,
    globalSetup: ["./test/support/native-service-zone-source-provenance.ts"],
    include: [
      "test/native-service-zone-source-provenance.proof.ts",
      "test/logical-service-zone-creation-workflow.test.ts",
      "test/logical-service-zone-deletion-workflow.test.ts",
      "test/logical-service-zone-update-workflow.test.ts",
    ],
  },
});
