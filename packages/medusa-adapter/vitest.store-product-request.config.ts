import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";

export default defineConfig({ ...native, test: { ...native.test, globalSetup: [],
  include: ["test/store-product-request.test.ts", "test/store-product-query-context.test.ts",
    "test/store-product-context-read-contracts.test.ts", "test/store-product-pricing-graph.test.ts"],
  hookTimeout: 300_000, testTimeout: 300_000,
} });
