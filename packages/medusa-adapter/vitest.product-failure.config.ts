import { defineConfig } from "vitest/config";
import upstream, { productCoverage } from "./vitest.product-upstream.config";

export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-failure.test.ts"], reporters: ["default", productCoverage([
    "Product service > preserves a shared row statement cancellation and rolls back the complete command",
    "Product service > preserves a shared outcome statement cancellation and rolls back the complete command",
  ])],
} });
