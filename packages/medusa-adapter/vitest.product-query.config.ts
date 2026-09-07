import { mergeConfig } from "vitest/config";
import product from "./vitest.product.config.ts";

export default mergeConfig({ ...product, test: { ...product.test, include: [] } }, {
  test: {
    include: ["test/product-local.test.ts", "test/product-runtime-metadata.test.ts", "test/product-query.test.ts", "test/query-profile.test.ts"],
  },
});
