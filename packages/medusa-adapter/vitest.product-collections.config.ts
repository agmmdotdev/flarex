import { defineConfig } from "vitest/config";
import upstream, { productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-collections-upstream.test.ts"],
  reporters: ["default", productCoverage([
    "Product service > Product Collection boundary > rolls back earlier Collection and Product changes when a later upsert member fails",
    "Product service > Product Collection boundary > refuses unadmitted inputs without publication or widening ordinary Product queries",
  ])],
} });
