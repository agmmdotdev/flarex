import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import upstream, { admittedProductCategoryCases, productCoverage } from "./vitest.product-upstream.config";

export default defineConfig({
  ...upstream,
  resolve: { ...upstream.resolve, alias: [
    { find: /^@medusajs\/test-utils$/, replacement: fileURLToPath(new URL("./test/support/logical-public-category-runner.ts", import.meta.url)) },
    ...(Array.isArray(upstream.resolve?.alias) ? upstream.resolve.alias.filter(alias =>
      !(alias.find instanceof RegExp && alias.find.source === "^@medusajs\\/test-utils$")) : []),
  ] },
  test: {
    ...upstream.test,
    include: ["test/product-public-categories-upstream.test.ts"],
    reporters: ["default", productCoverage(admittedProductCategoryCases)],
  },
});
