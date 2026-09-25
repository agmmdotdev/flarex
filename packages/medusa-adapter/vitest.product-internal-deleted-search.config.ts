import { defineConfig } from "vitest/config";
import legacy from "./vitest.legacy-product.config";
import { productCoverage } from "./vitest.product-upstream.config";

/** Retained until generic indexed text search supports withDeleted queries. */
export default defineConfig({ ...legacy, test: { ...legacy.test,
  include: ["test/product-internal-deleted-search-legacy.test.ts"],
  reporters: ["default", productCoverage([
    "Internal Product deleted search legacy boundary > includes deleted matches in an unanchored free-text query",
  ])],
} });
