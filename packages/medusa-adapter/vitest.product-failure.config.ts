import { defineConfig } from "vitest/config";
import upstream from "./vitest.product-upstream.config";

export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-failure.test.ts"], reporters: ["default"],
} });
