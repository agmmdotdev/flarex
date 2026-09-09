import { defineConfig } from "vitest/config";
import upstream, { admittedProductOptionCases, productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-options-upstream.test.ts"],
  reporters: ["default", productCoverage([...admittedProductOptionCases,
    "Product Option boundary > isolates parent projections and counts from colliding foreign scope rows",
    "Product Option boundary > deletes cascaded values and pivots atomically with root-only events and replay",
    "Product Option boundary > rolls back a new Option and its values when a later upsert member is missing",
    "Product Option boundary > refuses unsupported Option reads and mutations without publication",
  ])],
} });
