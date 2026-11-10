import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";
export default defineConfig({ ...native, test: { ...native.test, globalSetup: [],
  include: ["test/product-request.test.ts", "test/product-request-variants.test.ts", "test/product-request-variant-reads.test.ts", "test/product-request-variant-inventory-links.test.ts", "test/product-request-variant-remote.test.ts", "test/product-request-options.test.ts", "test/product-request-images.test.ts", "test/product-request-catalog-taxonomy.test.ts", "test/product-request-category-reads.test.ts", "test/product-request-categories-collections.test.ts", "test/product-create-references-input.test.ts", "test/logical-product-creation-workflow.test.ts"], hookTimeout: 300_000, testTimeout: 300_000,
} });
