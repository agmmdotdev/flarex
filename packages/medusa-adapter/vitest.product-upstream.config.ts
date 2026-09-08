import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Reporter } from "vitest/node";
export const admittedProductTypeCases = [
  "Product service > ProductModuleService product types > listTypes > should return types and count queried by ID",
  "Product service > ProductModuleService product types > listTypes > should return types and count based on the options and filter parameter",
  "Product service > ProductModuleService product types > listTypes > should return only requested fields for types",
  "Product service > ProductModuleService product types > listAndCountTypes > should return types and count queried by ID",
  "Product service > ProductModuleService product types > listAndCountTypes > should return types and count based on the options and filter parameter",
  "Product service > ProductModuleService product types > listAndCountTypes > should return only requested fields for types",
  "Product service > ProductModuleService product types > retrieveType > should return the requested type",
  "Product service > ProductModuleService product types > retrieveType > should return requested attributes when requested through config",
  "Product service > ProductModuleService product types > retrieveType > should throw an error when a type with ID does not exist",
  "Product service > ProductModuleService product types > deleteTypes > should delete the product type given an ID successfully",
  "Product service > ProductModuleService product types > updateTypes > should update the value of the type successfully",
  "Product service > ProductModuleService product types > updateTypes > should throw an error when an id does not exist",
  "Product service > ProductModuleService product types > createTypes > should create a type successfully"
];
export const admittedProductCases = [
  ...admittedProductTypeCases,
  "Product injected event bus > ProductModuleService Events > Product Deletion > should emit all cascade delete events when soft deleting a product",
  "Product injected event bus > ProductModuleService Events > Delete Operations - Base Service Automatic Events > should emit delete events for all entity types via base service",
  "Product service > ProductModuleService products > softDelete > should soft delete a product and its cascaded relations",
  "Product service > ProductModuleService products > softDelete > should retrieve soft-deleted products if filtered on deleted_at",
  "Product service > ProductModuleService products > restore > should restore a soft deleted product and its cascaded relations",
  "Product injected event bus > ProductModuleService Events > Product Creation > should emit all related events when creating a product with full relations",
  "Product injected event bus > ProductModuleService Events > Product Update > should emit cascade events when updating product with relations",
  "Product injected event bus > ProductModuleService Events > Product Variant Operations > should emit PRODUCT_VARIANT_CREATED event only when creating standalone variant",
  "Product injected event bus > ProductModuleService Events > Product Variant Operations > should emit PRODUCT_VARIANT_UPDATED event only when updating variant",
  "Product injected event bus > ProductModuleService Events > Product Tag Operations > should emit PRODUCT_TAG_CREATED event on createProductTags",
  "Product injected event bus > ProductModuleService Events > Product Tag Operations > should emit PRODUCT_TAG_UPDATED event on updateProductTags",
  "Product injected event bus > ProductModuleService Events > Product Tag Operations > should emit appropriate events on upsertProductTags",
  "Product injected event bus > ProductModuleService Events > Product Type Operations > should emit PRODUCT_TYPE_CREATED event on createProductTypes",
  "Product injected event bus > ProductModuleService Events > Product Type Operations > should emit PRODUCT_TYPE_UPDATED event on updateProductTypes",
  "Product injected event bus > ProductModuleService Events > Product Type Operations > should emit appropriate events on upsertProductTypes",
  "Product injected event bus > ProductModuleService Events > Product Option Operations > should emit PRODUCT_OPTION_CREATED event on createProductOptions",
  "Product injected event bus > ProductModuleService Events > Product Option Operations > should emit PRODUCT_OPTION_UPDATED event on updateProductOptions",
  "Product injected event bus > ProductModuleService Events > Product Option Operations > should emit appropriate events on upsertProductOptions",
  "Product injected event bus > ProductModuleService Events > Product Option Value Operations > should emit PRODUCT_OPTION_VALUE_UPDATED event on updateProductOptionValues",
  "Product injected event bus > ProductModuleService Events > Product Collection Operations > should emit PRODUCT_COLLECTION_CREATED event on createProductCollections",
  "Product injected event bus > ProductModuleService Events > Product Collection Operations > should emit PRODUCT_COLLECTION_UPDATED event on updateProductCollections",
  "Product injected event bus > ProductModuleService Events > Product Collection Operations > should emit appropriate events on upsertProductCollections",
  "Product injected event bus > ProductModuleService Events > Product Category Operations > should emit PRODUCT_CATEGORY_CREATED event on createProductCategories",
  "Product injected event bus > ProductModuleService Events > Product Category Operations > should emit PRODUCT_CATEGORY_UPDATED event on updateProductCategories",
  "Product injected event bus > ProductModuleService Events > Product Category Operations > should emit appropriate events on upsertProductCategories",
  "Product service > ProductModuleService products > update > should update multiple products",
  "Product service > ProductModuleService products > update > should update a product and upsert relations that are not created yet",
  "Product service > ProductModuleService products > update > should upsert variants (update one and create one)",
  "Product service > ProductModuleService products > update > should preserve option and value identity on update",
  "Product service > ProductModuleService products > update > should add relationships to a product",
  "Product service > ProductModuleService products > update > should upsert a product type when type object is passed",
  "Product service > ProductModuleService products > update > should replace relationships of a product",
  "Product service > ProductModuleService products > update > should remove relationships of a product",
  "Product service > ProductModuleService products > update > should throw an error when product ID does not exist",
  "Product service > ProductModuleService products > update > should update, create and delete variants",
  "Product service > ProductModuleService products > update > should do a partial update on the options of a variant successfully",
  "Product service > ProductModuleService products > update > should create a variant with id that was passed if it does not exist",
  "Product service > ProductModuleService products > update > should simultaneously update options and variants",
  "Product service > ProductModuleService products > update > should throw an error when some tag id does not exist",
  "Product service > ProductModuleService products > update > should throw an error when some category id does not exist",
  "Product service > ProductModuleService products > update > should throw an error when collection id does not exist",
  "Product service > ProductModuleService products > update > should throw an error when type id does not exist",
  "Product service > ProductModuleService products > update > should throw if two variants have the same options combination",
  "Product service > ProductModuleService products > update > should throw if a variant doesn't have all options set",
  "Product service > ProductModuleService products > update > should throw if a variant uses a non-existing option",
  "Product service > ProductModuleService products > create > should create a product",
  "Product service > ProductModuleService products > create > should throw because variant doesn't have all options set",
  "Product service > ProductModuleService products > list > should return a list of products scoped by collection id",
  "Product service > ProductModuleService products > list > should return a list of products scoped by variant options",
  "Product service > ProductModuleService products > list > should return empty array when querying for a collection that doesnt exist",
  "Product service > ProductModuleService products > images > should create images with correct rank",
  "Product service > ProductModuleService products > images > should update images with correct rank",
  "Product service > ProductModuleService products > images > should delete images if empty array is passed on update",
  "Product service > ProductModuleService products > images > should retrieve images in the correct order consistently",
  "Product service > ProductModuleService products > images > should retrieve images ordered by rank",
  "Product service > ProductModuleService products > images > should populate variant.images when variants.images relation is requested",
];
export const productCoverage = (expected: readonly string[]): Reporter => {
  const executed: string[] = [];
  return {
    onTestRunStart() { executed.length = 0; },
    onTestCaseResult(test) { if (test.result().state !== "skipped") executed.push(test.fullName); },
    onTestRunEnd() {
      if (executed.length !== expected.length || expected.some(name => executed.filter(value => value === name).length !== 1)) {
        throw new Error("Product upstream coverage mismatch: expected all " + expected.length + " admitted cases to execute");
      }
    },
  };
};
export default defineConfig({
  resolve: { alias: [
    { find: /^@medusajs\/test-utils$/, replacement: fileURLToPath(new URL("./test/support/runner.ts", import.meta.url)) },
    { find: /^@models$/, replacement: fileURLToPath(new URL("../medusa-product/src/models/index.ts", import.meta.url)) },
    { find: /^@types$/, replacement: fileURLToPath(new URL("../medusa-product/src/types/index.ts", import.meta.url)) },
    { find: "cloudflare:workers", replacement: fileURLToPath(new URL("../persistence-postgres/test/cloudflareWorkersStub.ts", import.meta.url)) },
  ] },
  test: { env: { FLAREX_PRODUCT_RESOURCES: "scale" }, globals: true, maxWorkers: 1, fileParallelism: false, include: ["test/product-upstream.test.ts"],
    reporters: ["default", productCoverage(admittedProductCases)],
    hookTimeout: 120000, testTimeout: 100000,
  },
});
