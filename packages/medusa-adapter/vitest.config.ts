import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
 resolve: { alias: [
  { find: "@services", replacement: fileURLToPath(new URL("../medusa-currency/src/services/index.ts", import.meta.url)) },
  { find: /^@medusajs\/test-utils$/, replacement: fileURLToPath(new URL("./test/support/runner.ts", import.meta.url)) },
 ] },
 test: { globals: true, maxWorkers: 1, fileParallelism: false, setupFiles: ["./test/support/setup.ts"],
 env: { MEDUSA_COMPARISON_DRIVER: "pglite" },
 exclude: ["test/product-upstream.test.ts", "test/product-scale.test.ts", "test/product-types-upstream.test.ts", "test/product-tags-upstream.test.ts", "test/product-collections-upstream.test.ts", "test/product-options-upstream.test.ts"],
 include: ["test/**/*.test.ts", "../medusa-currency/src/**/__tests__/**/*.ts", "../medusa-currency/integration-tests/**/*.spec.ts"],
 hookTimeout: 30000, testTimeout: 100000,
 },
});
