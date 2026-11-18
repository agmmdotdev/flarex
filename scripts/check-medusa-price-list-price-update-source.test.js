// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripNativePriceListPriceUpdatePricingExtension, verifyNativePriceListPriceUpdate } from "./check-medusa-price-list-price-update-source.mjs";

const read = (/** @type {string} */ file) => readFileSync(file, "utf8");
const sources = {
  pricing: read("packages/medusa-pricing/src/services/pricing-module.ts"),
  step: read("packages/medusa-core-flows/src/price-list/steps/update-price-list-prices.ts"),
  workflow: read("packages/medusa-core-flows/src/price-list/workflows/update-price-list-prices.ts"),
  types: read("packages/medusa-types/src/pricing/price-list-price-update.ts"),
  index: read("packages/medusa-types/src/pricing/index.ts"),
};

describe("approved native PriceList Price update compensation source", () => {
  it("admits the exact private extension and leaves unrelated Pricing source for its existing owner", () => {
    expect(() => verifyNativePriceListPriceUpdate(sources)).not.toThrow();
    const reversed = stripNativePriceListPriceUpdatePricingExtension(sources.pricing);
    expect(reversed).not.toContain("async snapshotPriceListPricesForUpdate(");
    expect(reversed).not.toContain("async restorePriceListPrices(");
    expect(reversed).toContain("async updatePriceListPrices(");
    expect(reversed).toContain("buildPreNormalizationPriceConstraintsFromData(");
  });
  it.each([
    ["pricing", "complete raw-ID cohort", "$or: [candidates, { id: suppliedIds }]", "$or: [candidates]"],
    ["pricing", "historical visibility", "{ withDeleted: true }", "{ withDeleted: false }"],
    ["pricing", "complete Rule query", "{ price_id: roots.map(price => price.id) }", "{ price_id: [] }"],
    ["pricing", "detached snapshots", "return structuredClone({ prices:", "return ({ prices:"],
    ["pricing", "original Rule identities", "id: rule.id, price_id: rule.price_id", "id: 'new-rule', price_id: rule.price_id"],
    ["pricing", "native raw numeric precision", "amount: price.raw_amount", "amount: price.amount"],
    ["pricing", "same inverse context", "this.priceService_.delete(data.createdPriceIds, sharedContext)", "this.priceService_.delete(data.createdPriceIds, {})"],
    ["pricing", "complete native relation replay", 'before,\n        { relations: ["price_rules"] }', 'before,\n        { relations: [] }'],
    ["step", "original forward", "pricingModule.updatePriceListPrices(", "pricingModule.addPriceListPrices("],
    ["step", "actual target partition", "new Set(updatedPrices.map(price => price.id))", "new Set<string>()"],
    ["step", "retained before graph", "snapshot.prices.filter(price => affected.has(price.id))", "snapshot.prices"],
    ["step", "real native inverse", "pricingModule.restorePriceListPrices(data)", "pricingModule.updatePriceListPrices([])"],
    ["workflow", "parallel List validator", "validatePriceListsStep(input.data)", "validatePriceListsStep([])"],
    ["workflow", "parallel Link validator", "validateVariantPriceLinksStep(input.data)", "validateVariantPriceLinksStep([])"],
    ["types", "full Rule operator", "operator: PricingRuleOperatorValues", "operator?: PricingRuleOperatorValues"],
    ["types", "private resource signature", "createdPriceIds: string[]", "createdPriceIds: unknown[]"],
    ["index", "closed native type exports", 'export * from "./price-list-price-update"', 'export * from "./arbitrary-replay"'],
  ])("rejects %s changed %s", (key, _label, before, after) => {
    const field = /** @type {keyof typeof sources} */ (key);
    const changed = sources[field].replace(before, after);
    expect(changed).not.toBe(sources[field]);
    expect(() => verifyNativePriceListPriceUpdate({ ...sources, [field]: changed })).toThrow("Changed approved native PriceList Price update compensation");
  });
  it("does not erase an unapproved method with a matching name", () => {
    const changed = sources.pricing.replace("  async restorePriceListPrices(", "  async restorePriceListPrices(\n    injected: unknown,");
    expect(() => stripNativePriceListPriceUpdatePricingExtension(changed)).toThrow();
  });
});
