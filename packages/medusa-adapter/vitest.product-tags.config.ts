import { defineConfig } from "vitest/config";
import upstream, { admittedProductTagCases, productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-tags-upstream.test.ts"],
  reporters: ["default", productCoverage([...admittedProductTagCases,
    "Product Tag boundary > isolates inverse relations and preserves empty and collection projections",
    "Product Tag boundary > authenticates DTO echoes and refuses unsupported inputs without publication",
    "Product Tag boundary > rolls back a new Tag when a later upsert member is missing",
  ])],
} });
