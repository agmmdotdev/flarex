import { defineConfig } from "vitest/config";
import upstream, { admittedProductTypeCases, productCoverage } from "./vitest.product-upstream.config";

export default defineConfig({
  ...upstream,
  test: {
    ...upstream.test,
    include: ["test/product-types-upstream.test.ts"],
    reporters: ["default", productCoverage([...admittedProductTypeCases,
      "Product Type boundary > isolates Type reads and counts from foreign scope rows",
      "Product Type boundary > rejects unsupported read inputs without publication",
    ])],
  },
});
