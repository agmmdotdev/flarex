// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "@typescript/typescript6";
import { variantItemPricingSourcePairs, variantItemPricingRequiredCurrencySource, verifyNativeRequiredCurrencyGuard,
  verifyVariantItemPricingSource, verifyVariantItemPricingSourcePair } from "./check-medusa-variant-item-pricing-source.mjs";

const entries = variantItemPricingSourcePairs.map(pair => ({ ...pair,
  native: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") }));
const rootPath = "packages/medusa-core-flows/src/cart/workflows/get-variants-and-items-with-prices.ts";
const stepPath = "packages/medusa-core-flows/src/cart/steps/get-variant-price-sets.ts";
const mapperPath = "packages/medusa-core-flows/src/cart/utils/prepare-line-item-data.ts";
const customerPath = "packages/medusa-types/src/customer/common.ts";
const readonlyPath = "packages/medusa-link-modules/src/definitions/readonly/inventory-level-stock-location.ts";
/** @param {string} target */
const entry = target => {
  const found = entries.find(pair => pair.target === target);
  if (!found) throw new Error("Missing declared source pair " + target);
  return found;
};
/** @param {string} target @param {string} before @param {string} after */
const mutant = (target, before, after) => {
  const selected = entry(target), changed = selected.actual.replace(before, after);
  expect(changed).not.toBe(selected.actual);
  expect(() => verifyVariantItemPricingSourcePair(target, selected.native, changed)).toThrow("Changed native Variant Item pricing source");
};

describe("native159 exact source closure", () => {
  it.each(entries)("preserves $target", ({ target, native, actual }) => {
    expect(() => verifyVariantItemPricingSourcePair(target, native, actual)).not.toThrow();
  });
  it("rejects owners outside the declared closure", () => {
    expect(() => verifyVariantItemPricingSourcePair("packages/medusa-core-flows/src/cart/other.ts", "", "")).toThrow("unknown pair");
    expect(() => verifyVariantItemPricingSource(process.cwd(), { unknown: { target: "" } })).toThrow("unknown override");
  });
  it("accepts layout/comments while retaining complete typed and emitted trees", () => {
    const selected = entry(rootPath);
    expect(() => verifyVariantItemPricingSourcePair(rootPath, selected.native,
      "/* reviewed layout */\n" + selected.actual.replace("priceNotFound: string[]", "priceNotFound : string [ ]"))).not.toThrow();
  });
  it.each([rootPath, stepPath, mapperPath])("rejects extra execution in %s", target => {
    const selected = entry(target);
    expect(() => verifyVariantItemPricingSourcePair(target, selected.native, selected.actual + "\nthrow new Error('extra');\n")).toThrow();
  });
});

describe("native159 item/context callbacks", () => {
  it.each([
    ["zero custom truthiness", "is_custom_price: !!item.unit_price", "is_custom_price: isDefined(item.unit_price)"],
    ["explicit zero output flag", "item_.is_custom_price ?? isDefined(item?.unit_price)", "item_.is_custom_price || !!item?.unit_price"],
    ["explicit Variant IDs", "if (data.variantIds)", "if (data.variantIds?.length)"],
    ["Cart item selection precedence", "data.cart.items ?? data.items ?? []", "data.items ?? data.cart.items ?? []"],
    ["input pricing item precedence", "data.items ?? cart.items ?? []", "cart.items ?? data.items ?? []"],
    ["context merge order", "...filterObjectByKeys(cart, cartFieldsForPricingContext),\n          customer: cart.customer,\n          region: cart.region,\n          ...(data.setPricingContextResult ? data.setPricingContextResult : {}),", "...(data.setPricingContextResult ? data.setPricingContextResult : {}),\n          ...filterObjectByKeys(cart, cartFieldsForPricingContext),\n          customer: cart.customer,\n          region: cart.region,"],
    ["currency fallback", "cart.currency_code ?? cart.region?.currency_code", "cart.region?.currency_code ?? cart.currency_code"],
    ["native missing-price dereference", "input.unitPrice = calculatedPriceSet!.calculated_amount!", "input.unitPrice = calculatedPriceSet?.calculated_amount"],
    ["publication predicate", "variant.product.status !== ProductStatus.PUBLISHED", "variant.product.status === ProductStatus.PUBLISHED"],
    ["original item selector", "selector: { id: (item_ as CartLineItemDTO).id }", "selector: { id: item_.variant_id }"],
    ["Variant mutation", 'variant.calculated_price = calculatedPriceSet as NonNullable<PrepareLineItemDataInput["variant"]>["calculated_price"]', "variant.calculated_price = undefined"],
    ["leaf child owner", 'from "../steps/get-variant-price-sets"', 'from "../steps"'],
    ["portable utility owner", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
    ["type owner", 'from "@medusajs/types"', 'from "@medusajs/other-types"'],
    ["public input DTO", "cart: Partial<CartDTO>", "cart: CartDTO"],
  ])("rejects changed %s", (_label, before, after) => mutant(rootPath, before, after));
  it.each([
    ["group key sorting", ".sort(([a], [b]) => a.localeCompare(b))", ".sort(([a], [b]) => b.localeCompare(a))"],
    ["context group ownership", "const contextKey = createContextKey(item.context)", "const contextKey = item.variantId"],
    ["context group append", "existingGroup.push(item)", "existingGroup.unshift(item)"],
    ["bulk context retention", "context: item.context", "context: {}"],
    ["calculation grouping", "{ id: priceSetIds }", "{ id: priceSetIds.slice(0, 1) }"],
    ["required Pricing resolution", "Modules.PRICING", '"product"'],
    ["empty resolution order", "const pricingModuleService = container.resolve", "if ('data' in data && !data.data.length) return new StepResponse({});\n    const pricingModuleService = container.resolve"],
    ["actual item output key", "result[item.id ?? item.variantId]", "result[item.variantId]"],
    ["custom link validation", "!!item.context?.is_custom_price", "isDefined(item.context?.is_custom_price)"],
    ["native graph cache hint", "enable: true", "enable: false"],
    ["erased graph type owner", "type Query = { graph: QueryGraphFunction }", "type Query = { graph: unknown }"],
  ])("rejects changed %s", (_label, before, after) => mutant(stepPath, before, after));
});

describe("native159 line item mapper", () => {
  it.each([
    ["tax boolean", "is_tax_inclusive: !!isTaxInclusive", "is_tax_inclusive: isTaxInclusive ?? true"],
    ["inventory shipping quantifier", "variant?.inventory_items?.some(", "variant?.inventory_items?.every("],
    ["shipping profile combination", "hasShippingProfile || someInventoryRequiresShipping", "hasShippingProfile && someInventoryRequiresShipping"],
    ["explicit shipping override", "isDefined(item?.requires_shipping)", "!!item?.requires_shipping"],
    ["quantity refusal", "MathBN.lte(item.quantity, 0)", "MathBN.lt(item.quantity, 0)"],
    ["sale compare at price", "compareAtUnitPrice = variant.calculated_price.original_amount", "compareAtUnitPrice = variant.calculated_price.calculated_amount"],
    ["item null metadata", "metadata: item?.metadata ?? {}", "metadata: item?.metadata"],
    ["Product type null", "variant?.product?.type?.value ?? null", "variant?.product?.type?.value ?? ''"],
  ])("rejects changed %s", (_label, before, after) => mutant(mapperPath, before, after));
});

describe("native159 exact fields and pure types", () => {
  it("admits the original two-DTO extraction and the complete byte-exact native Customer leaf", () => {
    const selected = entry(customerPath);
    const parsed = ts.createSourceFile("customer.ts", selected.native, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const extracted = ["CustomerAddressDTO", "CustomerDTO"].map(name => {
      const declarations = parsed.statements.filter(node => ts.isInterfaceDeclaration(node) && node.name.text === name);
      expect(declarations).toHaveLength(1);
      const declaration = declarations[0];
      if (declaration === undefined) throw new Error("Missing original Customer DTO");
      return declaration.getText(parsed);
    }).join("\n\n");
    expect(() => verifyVariantItemPricingSourcePair(customerPath, selected.native, extracted)).not.toThrow();
    expect(() => verifyVariantItemPricingSourcePair(customerPath, selected.native, selected.native)).not.toThrow();
    expect(() => verifyVariantItemPricingSourcePair(customerPath, selected.native, extracted + "\nexport interface Extra { id: string }"))
      .toThrow();
  });
  it.each([
    ["layout-only full closure", (/** @type {string} */ source) => "/* extra layout */\n" + source],
    ["edited full closure declaration", (/** @type {string} */ source) => source.replace("export interface CustomerGroupDTO", "export interface OtherCustomerGroupDTO")],
    ["partial new closure", (/** @type {string} */ source) => source.slice(0, source.indexOf("export interface CustomerDTO"))],
    ["duplicate full closure", (/** @type {string} */ source) => source + source],
  ])("rejects %s beyond the original Customer extraction", (_label, change) => {
    const selected = entry(customerPath), changed = change(selected.native);
    expect(changed).not.toBe(selected.native);
    expect(() => verifyVariantItemPricingSourcePair(customerPath, selected.native, changed)).toThrow();
  });
  it("retains exact field order and source bytes", () => {
    mutant("packages/medusa-core-flows/src/cart/utils/fields.ts", '"inventory_items.required_quantity"', '"inventory_items.required_quantity", "metadata"');
  });
  it("retains the genuine utility's null branch", () => {
    mutant("packages/medusa-utils/src/common/filter-object-by-keys.ts", "source === null", "source == null");
  });
  it.each([
    ["packages/medusa-types/src/cart/mutations.ts", "selector: Partial<CartLineItemDTO>", "selector: CartLineItemDTO"],
    ["packages/medusa-types/src/cart/workflows.ts", "quantity: BigNumberInput", "quantity: number"],
    ["packages/medusa-types/src/workflow/order/items.ts", "unit_price?: BigNumberInput | null", "unit_price?: BigNumberInput"],
    [customerPath, "addresses: CustomerAddressDTO[]", "addresses: CustomerDTO[]"],
    [customerPath, "metadata: Record<string, unknown>", "metadata: Record<string, string>"],
  ])("rejects altered declaration in %s", (target, before, after) => mutant(target, before, after));
  it.each([
    "\nexport interface ExtraCustomerType { id: string }\n",
    "\nimport type { AddressDTO } from '../address';\n",
    "\nexport type CustomerAlias = CustomerDTO;\n",
    "\nexport const customerReference = globalThis;\n",
  ])("refuses Customer closure expansion %s", extra => {
    const selected = entry(customerPath);
    expect(() => verifyVariantItemPricingSourcePair(customerPath, selected.native, selected.actual + extra)).toThrow();
  });
});

describe("native159 readonly Inventory Level Stock Location Link", () => {
  it.each([
    ["read only authority", "isReadOnlyLink: true", "isReadOnlyLink: false"],
    ["Link identity", "isLink: true", "isLink: false"],
    ["primary service", "serviceName: Modules.INVENTORY", "serviceName: Modules.PRICING"],
    ["foreign service", "serviceName: Modules.STOCK_LOCATION", "serviceName: Modules.INVENTORY"],
    ["primary entity", 'entity: "InventoryLevel"', 'entity: "InventoryItem"'],
    ["foreign entity", 'entity: "StockLocation"', 'entity: "StockLocationAddress"'],
    ["primary key", 'primaryKey: "id"', 'primaryKey: "location_id"'],
    ["foreign key", 'foreignKey: "location_id"', 'foreignKey: "id"'],
    ["native alias", 'alias: "stock_locations"', 'alias: "locations"'],
    ["native method suffix", 'methodSuffix: "StockLocations"', 'methodSuffix: "InventoryItems"'],
    ["cardinality", "isList: true", "isList: false"],
    ["portable owner", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
  ])("rejects changed %s", (_label, before, after) => mutant(readonlyPath, before, after));
});

describe("native159 required Pricing currency guard extraction", () => {
  const native = readFileSync(variantItemPricingRequiredCurrencySource.source, "utf8");
  const actual = readFileSync(variantItemPricingRequiredCurrencySource.target, "utf8");
  it("retains the complete native guard from the actual repository method", () => {
    expect(() => verifyNativeRequiredCurrencyGuard(native, actual)).not.toThrow();
  });
  it.each([
    ["truthiness", "if (!currencyCode)", "if (currencyCode === undefined)"],
    ["empty string", "if (!currencyCode)", "if (currencyCode == null)"],
    ["native error type", "MedusaError.Types.INVALID_DATA", "MedusaError.Types.NOT_FOUND"],
    ["native error instance", "throw new MedusaError(", "throw new Error("],
    ["native error message", "Method calculatePrices requires currency_code in the pricing context", "Currency not found"],
    ["export", "export function validatePricingCurrencyCode", "function validatePricingCurrencyCode"],
    ["name", "export function validatePricingCurrencyCode", "export function allowPricingCurrencyCode"],
    ["parameter", "validatePricingCurrencyCode(currencyCode: unknown)", "validatePricingCurrencyCode(currencyCode: string)"],
    ["return type", "validatePricingCurrencyCode(currencyCode: unknown): void", "validatePricingCurrencyCode(currencyCode: unknown): unknown"],
    ["extra execution", "validatePricingCurrencyCode(currencyCode: unknown): void {", "validatePricingCurrencyCode(currencyCode: unknown): void { repairCurrency();"],
    ["error owner", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/other-utils"'],
  ])("rejects changed %s", (_label, before, after) => {
    const changed = actual.replace(before, after);
    expect(changed).not.toBe(actual);
    expect(() => verifyNativeRequiredCurrencyGuard(native, changed)).toThrow("Changed native Variant Item pricing source");
  });
  it("rejects a second helper declaration and a separately imported error alias", () => {
    expect(() => verifyNativeRequiredCurrencyGuard(native, actual + "\nexport function validatePricingCurrencyCode(currencyCode: unknown): void {}"))
      .toThrow("Changed native Variant Item pricing source");
    expect(() => verifyNativeRequiredCurrencyGuard(native, actual + '\nimport { MedusaError as OtherError } from "@medusajs/framework/utils/portable";'))
      .toThrow("Changed native Variant Item pricing source");
  });
  it.each([
    ["class", "export class PricingRepository", "export class OtherPricingRepository"],
    ["method", "async calculatePrices(", "async otherCalculatePrices("],
    ["currency field", "const currencyCode = context.currency_code", "const currencyCode = context.region_id"],
    ["context deletion", "delete context.currency_code", "delete context.region_id"],
    ["native predicate", "if (!currencyCode)", "if (currencyCode === null)"],
  ])("rejects displaced native %s owner", (_label, before, after) => {
    const changed = native.replace(before, after);
    expect(changed).not.toBe(native);
    expect(() => verifyNativeRequiredCurrencyGuard(changed, actual)).toThrow("Changed native Variant Item pricing source");
  });
});
