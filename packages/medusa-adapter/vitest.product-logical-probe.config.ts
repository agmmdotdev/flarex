import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import upstream from "./vitest.product-upstream.config";

/** Cutover probe for the complete pinned Product suite. Remove with the
 * physical runner after the logical host becomes the sole native runner. */
export default defineConfig({
  ...upstream,
  resolve: { ...upstream.resolve, alias: [
    { find: /^@medusajs\/test-utils$/, replacement: fileURLToPath(new URL("./test/support/logical-product-runner.ts", import.meta.url)) },
    ...(upstream.resolve?.alias ?? []),
  ] },
  test: { ...upstream.test, reporters: ["json"], outputFile: "../../.tmp/product-logical-probe.json" },
});
