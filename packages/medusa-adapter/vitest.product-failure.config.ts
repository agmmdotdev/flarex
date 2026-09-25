import { defineConfig } from "vitest/config";
import upstream from "./vitest.legacy-product.config";

export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-failure.test.ts"], reporters: ["default"],
} });
