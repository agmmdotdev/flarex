import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";

export default defineConfig({ ...native, test: { ...native.test, globalSetup: [],
  include: ["test/store-cart-projection.test.ts", "test/store-cart-request.test.ts"], hookTimeout: 600_000, testTimeout: 300_000,
} });
