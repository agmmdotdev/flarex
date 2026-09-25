import { defineConfig } from "vitest/config";
import upstream, { productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-internal-upstream.test.ts"],
  reporters: ["default", productCoverage([
    "Product service > Internal Product boundary > searches active DML fields before paging and combines relation filters",
    "Product service > Internal Product boundary > updates every selected internal batch member beyond the public default page",
    "Product service > Internal Product boundary > retains internal facts and replay with scalar and array results and no publication",
    "Product service > Internal Product boundary > rolls back invalid arrays and authenticates internal lifecycle cascades",
  ])],
} });
