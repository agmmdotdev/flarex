import { defineConfig } from "vitest/config";
import upstream from "./vitest.product-upstream.config";

export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/core-product-managed-read.test.ts", "test/core-product-managed-read.postgres.test.ts"],
  reporters: ["default"],
} });
