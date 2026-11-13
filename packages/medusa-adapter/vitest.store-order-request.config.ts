import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";

export default defineConfig({ ...native, test: { ...native.test, globalSetup: [],
  include: ["test/store-order-*.test.ts", "test/id-read-profile.test.ts", "test/native-graph-input.test.ts",
    "test/checkout-id-read-receipts.test.ts", "test/native-query-bridge.test.ts", "test/store-cart-projection.test.ts"],
  hookTimeout: 600_000, testTimeout: 300_000,
} });
