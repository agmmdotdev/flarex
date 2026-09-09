import { defineConfig } from "vitest/config";
import upstream, { admittedProductVariantCases, productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-variants-upstream.test.ts"],
  reporters: ["default", productCoverage([...admittedProductVariantCases,
    "Product Variant boundary > isolates parent projections and counts from colliding foreign scope rows",
    "Product Variant boundary > removes exact image pairs atomically and replays without deleting images",
    "Product Variant boundary > soft deletes only the selected Variant with authenticated events and replay",
    "Product Variant boundary > refuses unsupported Variant inputs without publication",
  ])],
} });
