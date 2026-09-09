import { defineConfig } from "vitest/config";
import upstream, { admittedInternalCategoryCases, productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-internal-categories-upstream.test.ts"],
  reporters: ["default", productCoverage([...admittedInternalCategoryCases,
    "Internal Category boundary > retains write facts and replay with no internal publication while preserving public events",
    "Internal Category boundary > rolls back an earlier array member when a later internal update fails",
    "Internal Category boundary > refuses invalid complete arrays and authority fields without publication",
  ])],
} });
