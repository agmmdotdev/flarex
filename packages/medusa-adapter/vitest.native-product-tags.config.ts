import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";

export default defineConfig({ ...native, test: { ...native.test, globalSetup: [], include: [
  "test/product-tag-update-input.test.ts", "test/logical-product-tag-metadata.test.ts",
  "test/logical-product-tag-storage.test.ts", "test/logical-product-tag-lifecycle.test.ts",
  "test/logical-product-tag-retirement.test.ts", "test/product-tag-composition.test.ts",
], hookTimeout: 300_000, testTimeout: 300_000 } });
