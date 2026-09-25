import { defineConfig } from "vitest/config";
import upstream, { admittedProductCollectionCases, productCoverage } from "./vitest.legacy-product.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-collections-upstream.test.ts"],
  reporters: ["default", productCoverage([...admittedProductCollectionCases,
    "Product Collection boundary > isolates Collection projections and membership changes from colliding foreign scope rows",
    "Product Collection boundary > rolls back earlier Collection and Product changes when a later upsert member fails",
    "Product Collection boundary > refuses unadmitted inputs without publication or widening ordinary Product queries",
  ])],
} });
