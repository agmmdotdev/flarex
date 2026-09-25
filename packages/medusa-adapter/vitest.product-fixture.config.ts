import { defineConfig } from "vitest/config";
import upstream from "./vitest.legacy-product.config";

export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-fixture-reset.test.ts"], reporters: ["default"],
} });
