import { defineConfig } from "vitest/config";
import upstream, { admittedProductCollectionCases, productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-collections-upstream.test.ts"],
  reporters: ["default", productCoverage([...admittedProductCollectionCases,
    "Product Collection boundary > replaces and clears every member beyond the default page with complete facts and events",
    "Product Collection boundary > isolates Collection projections and membership changes from colliding foreign scope rows",
    "Product Collection boundary > rolls back earlier Collection and Product changes when a later upsert member fails",
    "Product Collection boundary > refuses unadmitted inputs without publication or widening ordinary Product queries",
  ])],
} });
