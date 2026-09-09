import { defineConfig } from "vitest/config";
import upstream, { admittedInternalProductCases, productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-internal-upstream.test.ts"],
  reporters: ["default", productCoverage([...admittedInternalProductCases,
    "Internal Product boundary > searches DML fields before paging and combines relation and deleted filters",
    "Internal Product boundary > updates every selected internal batch member beyond the public default page",
    "Internal Product boundary > retains internal facts and replay with scalar and array results and no publication",
    "Internal Product boundary > rolls back invalid arrays and authenticates internal lifecycle cascades",
  ])],
} });
