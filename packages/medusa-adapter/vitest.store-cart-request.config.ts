import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";

export default defineConfig({ ...native, test: { ...native.test, globalSetup: [],
  include: ["test/store-cart-projection.test.ts", "test/store-cart-request.test.ts", "test/store-cart-mutations-request.test.ts", "test/store-cart-promotions-request.test.ts", "test/store-cart-taxes-request.test.ts", "test/store-cart-shipping-request.test.ts", "test/workflow-query-context.test.ts", "test/workflow-definition-identity.test.ts"], hookTimeout: 600_000, testTimeout: 300_000,
} });
