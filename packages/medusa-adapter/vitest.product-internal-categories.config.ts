import { defineConfig } from "vitest/config";
import upstream, { admittedInternalCategoryCases, productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-internal-categories-upstream.test.ts"],
  reporters: ["default", productCoverage(admittedInternalCategoryCases)],
} });
