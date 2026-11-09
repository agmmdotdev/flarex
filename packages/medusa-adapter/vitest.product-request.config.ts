import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";
export default defineConfig({ ...native, test: { ...native.test, globalSetup: [],
  include: ["test/product-request.test.ts", "test/logical-product-creation-workflow.test.ts"], hookTimeout: 300_000, testTimeout: 300_000,
} });
