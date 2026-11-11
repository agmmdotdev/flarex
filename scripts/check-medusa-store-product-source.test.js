// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storeProductSourcePairs, storeProductTypePaths, verifyStoreProductSelection, verifyStoreProductSource } from "./check-medusa-store-product-source.mjs";

describe("selected native Store Product source provenance", () => {
  it("pins every selected source, target and classification", () => {
    expect(() => verifyStoreProductSelection(storeProductSourcePairs)).not.toThrow();
    for (const pair of storeProductSourcePairs) {
      expect(() => verifyStoreProductSelection(storeProductSourcePairs.map(current => current === pair ? { ...current, source: current.source + ".other" } : current))).toThrow();
      expect(() => verifyStoreProductSelection(storeProductSourcePairs.filter(current => current !== pair))).toThrow();
    }
  });
  it.each(storeProductSourcePairs)("preserves complete selected source $target", pair => {
    const native = readFileSync(pair.source, "utf8"), promoted = readFileSync(pair.target, "utf8");
    expect(() => verifyStoreProductSource(native, promoted, pair.target)).not.toThrow();
    if (!pair.target.endsWith("/utils/common-validators.ts")) {
      for (const suffix of ["\nthrow new Error('side effect');\n", "\nexport const unrelated = true;\n"])
        expect(() => verifyStoreProductSource(native, promoted + suffix, pair.target)).toThrow();
    }
  });
  it.each([
    ["store/collections/route.ts", "filters: req.filterableFields", "filters: {}"],
    ["store/collections/route.ts", "locale: req.locale", "locale: undefined"],
    ["store/collections/[id]/route.ts", "MedusaError.Types.NOT_FOUND", "MedusaError.Types.INVALID_DATA"],
    ["store/collections/validators.ts", 'order: "-created_at"', 'order: "id"'],
    ["store/products/middlewares.ts", "salesChannelCount > 1", "salesChannelCount > 0"],
    ["store/products/middlewares.ts", "delete req.filterableFields.sales_channel_id", "void req.filterableFields.sales_channel_id"],
    ["store/products/middlewares.ts", "status: ProductStatus.PUBLISHED", "status: ProductStatus.DRAFT"],
    ["store/products/middlewares.ts", "is_internal: false, is_active: true", "is_internal: true, is_active: false"],
    ["store/products/middlewares.ts", "allowUnauthenticated: true", "allowUnauthenticated: false"],
    ["store/products/middlewares.ts", "applyParamsAsFilters({ id: \"id\" })", "applyParamsAsFilters({ id: \"other\" })"],
    ["store/products/middlewares.ts", 'clearFiltersByKey(["region_id", "country_code", "province", "cart_id"])', "clearFiltersByKey([])"],
    ["store/products/route.ts", "return await getProductsWithIndexEngine(req, res)", "return await getProducts(req, res)"],
    ["store/products/route.ts", "await query.index(", "await query.graph("],
    ["store/products/route.ts", "QueryContext(", "Object.freeze("],
    ["store/products/route.ts", "metadata?.count ?? 0", "products.length"],
    ["store/products/[id]/route.ts", "scopedProductIds.includes(req.params.id)", "true"],
    ["store/products/[id]/route.ts", 'req.queryConfig.fields.push("categories.is_internal")', "void req.queryConfig.fields"],
    ["store/products/[id]/route.ts", "filterOutInternalProductCategories([product])", "void product"],
    ["store/products/helpers.ts", "!req.taxContext.taxInclusivityContext.automaticTaxes", "false"],
    ["store/products/helpers.ts", "await taxService.getTaxLines(", "await taxService.getTaxLinesWithoutContext("],
    ["store/products/helpers.ts", "includesTax:", "ignoredTax:"],
    ["store/products/helpers.ts", "quantity: 1", "quantity: 0"],
    ["utils/middlewares/products/filter-by-valid-sales-channels.ts", "if (uniqueInParams.length)", "if (false)"],
    ["utils/middlewares/products/filter-by-valid-sales-channels.ts", "if (!salesChannelIds.length)", "if (false)"],
    ["utils/middlewares/products/normalize-data-for-context.ts", "regionId = cart.region_id", "regionId = undefined"],
    ["utils/middlewares/products/normalize-data-for-context.ts", "stores[0]?.default_region_id", "undefined"],
    ["utils/middlewares/products/set-pricing-context.ts", "customers: { id: req.auth_context.actor_id }", "customers: {}"],
    ["utils/middlewares/products/set-tax-context.ts", "locale: req.locale", "locale: undefined"],
    ["utils/middlewares/products/variant-inventory-quantity.ts", "getVariantAvailability(query,", "getTotalVariantAvailability(query,"],
    ["utils/middlewares/products/variant-inventory-quantity.ts", "if (publishableApiKeySalesChannelIds.length === 1)", "if (publishableApiKeySalesChannelIds.length > 0)"],
    ["utils/common-validators.ts", "value.map(transform)", "value"],
  ])("refuses changed native behavior %s %s", (relative, before, after) => {
    const pair = storeProductSourcePairs.find(pair => pair.target === "packages/medusa-http/src/api/" + relative);
    if (!pair) throw new Error("Missing test source pair");
    const native = readFileSync(pair.source, "utf8"), promoted = readFileSync(pair.target, "utf8").replaceAll("\r\n", "\n");
    expect(promoted).toContain(before);
    expect(() => verifyStoreProductSource(native, promoted.replace(before, after), pair.target)).toThrow();
  });
  it.each(storeProductTypePaths)("rejects unselected type contracts in %s", relative => {
    const pair = storeProductSourcePairs.find(pair => pair.target === "packages/medusa-types/src/http/" + relative);
    if (!pair) throw new Error("Missing native type source pair");
    expect(() => verifyStoreProductSource(readFileSync(pair.source, "utf8"), readFileSync(pair.target, "utf8") + "\nexport type UnselectedContract = string;\n", pair.target)).toThrow();
  });
  it("retains exact type-only direct imports instead of unselected family barrels", () => {
    const pair = storeProductSourcePairs.find(pair => pair.target.endsWith("product/store/entitites.ts"));
    if (!pair) throw new Error("Missing native product type source pair");
    const native = readFileSync(pair.source, "utf8"), promoted = readFileSync(pair.target, "utf8");
    expect(() => verifyStoreProductSource(native, promoted.replace('"../../collection/store/entities"', '"../../collection"'), pair.target)).toThrow();
  });
});
