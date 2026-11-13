import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";
export default defineConfig({ ...native, test: { ...native.test, globalSetup: [],
  include: ["test/store-order-read-contracts.test.ts", "test/logical-store-order-read.test.ts", "test/link-read-cohort-policy.test.ts",
    "test/logical-store-order-fulfillment-read.test.ts", "test/store-order-read-workflows.test.ts",
    "test/order-version-population-cohort.test.ts", "test/order-finance-query.test.ts", "test/order-finance-version-query-contract.test.ts",
    "test/native-link-alias-cardinality.test.ts", "test/native-query-value-budget.test.ts", "test/workflow-value-depth.test.ts"],
  hookTimeout: 300_000, testTimeout: 120_000,
} });
