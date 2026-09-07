import { mergeConfig } from "vitest/config";
import product from "./vitest.product.config.ts";

export default mergeConfig({ ...product, test: { ...product.test, include: [] } }, {
  test: { include: ["test/product-value-profile.test.ts", "test/adapter-boundaries.test.ts", "test/currency-values.test.ts", "test/currency-schema.test.ts"] },
});
