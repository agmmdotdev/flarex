import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import upstream from "./vitest.product-upstream.config";

/** Named physical-only Product witnesses until their logical replacements land. */
export * from "./vitest.product-upstream.config";
export default defineConfig({
  ...upstream,
  test: { ...upstream.test, include: [], reporters: ["default"] },
  resolve: { ...upstream.resolve, alias: [
    { find: /^@medusajs\/test-utils$/, replacement: fileURLToPath(new URL("./test/support/legacy-product-runner.ts", import.meta.url)) },
    ...(Array.isArray(upstream.resolve?.alias) ? upstream.resolve.alias.filter(alias =>
      !(alias.find instanceof RegExp && alias.find.source === "^@medusajs\\/test-utils$")) : []),
  ] },
});
