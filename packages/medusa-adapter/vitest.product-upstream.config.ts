import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Reporter } from "vitest/node";
export const admittedProductCases = [
  "Product injected event bus > ProductModuleService Events > Product Creation > should emit all related events when creating a product with full relations",
  "Product service > ProductModuleService products > create > should throw because variant doesn't have all options set",
  "Product service > ProductModuleService products > images > should create images with correct rank",
  "Product injected event bus > ProductModuleService Events > Product Tag Operations > should emit PRODUCT_TAG_CREATED event on createProductTags",
  "Product injected event bus > ProductModuleService Events > Product Type Operations > should emit PRODUCT_TYPE_CREATED event on createProductTypes",
  "Product injected event bus > ProductModuleService Events > Product Collection Operations > should emit PRODUCT_COLLECTION_CREATED event on createProductCollections",
  "Product service > ProductModuleService products > create > should create a product",
  "Product service > ProductModuleService products > list > should return a list of products scoped by collection id",
  "Product service > ProductModuleService products > list > should return a list of products scoped by variant options",
  "Product service > ProductModuleService products > list > should return empty array when querying for a collection that doesnt exist",
  "Product service > ProductModuleService products > images > should retrieve images ordered by rank",
];
const admittedTitles = admittedProductCases.map(name => name.slice(name.indexOf("should ")));
const executed: string[] = [];
const coverage: Reporter = {
  onTestRunStart() { executed.length = 0; },
  onTestCaseResult(test) { if (test.result().state !== "skipped") executed.push(test.fullName); },
  onTestRunEnd() {
    if (executed.length !== admittedProductCases.length || admittedProductCases.some(name => executed.filter(value => value === name).length !== 1)) {
      throw new Error("Product upstream coverage mismatch: expected all " + admittedProductCases.length + " admitted cases to execute");
    }
  },
};
export default defineConfig({
  resolve: { alias: [
    { find: /^@medusajs\/test-utils$/, replacement: fileURLToPath(new URL("./test/support/runner.ts", import.meta.url)) },
    { find: /^@models$/, replacement: fileURLToPath(new URL("../medusa-product/src/models/index.ts", import.meta.url)) },
    { find: /^@types$/, replacement: fileURLToPath(new URL("../medusa-product/src/types/index.ts", import.meta.url)) },
    { find: "cloudflare:workers", replacement: fileURLToPath(new URL("../persistence-postgres/test/cloudflareWorkersStub.ts", import.meta.url)) },
  ] },
  test: { globals: true, maxWorkers: 1, fileParallelism: false, include: ["test/product-upstream.test.ts"],
    reporters: ["default", coverage],
    testNamePattern: new RegExp("(?:" + admittedTitles.join("|") + ")$"),
    hookTimeout: 120000, testTimeout: 100000,
  },
});
