// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyPricingNormalizationExtraction, verifyPricingCandidateConstraintExport } from "./check-medusa-pricing-normalization.mjs";

const source = readFileSync("third_party/medusa/upstream/packages/modules/pricing/src/services/pricing-module.ts", "utf8");
const target = readFileSync("packages/medusa-pricing/src/services/pricing-module.ts", "utf8");
const helper = readFileSync("packages/medusa-pricing/src/normalization.ts", "utf8");
describe("native Pricing normalization extraction provenance", () => {
  it("preserves both native algorithm bodies and the actual service delegation", () => {
    expect(verifyPricingNormalizationExtraction(source, target, helper)).toContain("  private normalizePrices(");
  });
  it.each([
    ["hash fields", 'parts.push(`cc:${price.currency_code ?? ""}`)', 'parts.push(`cc:${price.id ?? ""}`)'],
    ["native hash overwrite", "pricesToUpsert.set(entryHash, entry)", "pricesToUpsert.set(entryHash, { ...entry, id: undefined })"],
    ["empty raw rules", "isPresent(price.rules)", "Boolean(price.rules)"],
    ["operator grammar", "ruleOperatorsSet.has(customRule.operator)", "true"],
    ["retained rule IDs", "existing.price_rules ?? entry.price_rules", "entry.price_rules"],
  ])("refuses changed %s", (_label, before, after) => {
    expect(helper).toContain(before);
    expect(() => verifyPricingNormalizationExtraction(source, target, helper.replace(before, after)))
      .toThrow("Changed native Pricing normalization extraction");
  });
  it("refuses bypassing the extracted helper at the original service owner", () => {
    expect(() => verifyPricingNormalizationExtraction(source, target.replace("return normalizePricingPrices(data, existingPrices, priceListId)", "return []"), helper))
      .toThrow("Changed native Pricing normalization extraction");
  });
  it("retains only the same native candidate constraint builder as a named export", () => {
    expect(() => verifyPricingNormalizationExtraction(source,
      target.replace("export const buildPreNormalizationPriceConstraintsFromData = (", "const buildPreNormalizationPriceConstraintsFromData = ("), helper))
      .toThrow("Changed native Pricing normalization extraction");
  });
  it("exposes the same selector owner through only the existing private services barrel", () => {
    const original = readFileSync("third_party/medusa/upstream/packages/modules/pricing/src/services/index.ts", "utf8");
    const barrel = readFileSync("packages/medusa-pricing/src/services/index.ts", "utf8");
    expect(() => verifyPricingCandidateConstraintExport(original, barrel)).not.toThrow();
    expect(() => verifyPricingCandidateConstraintExport(original, barrel.replace("buildPreNormalizationPriceConstraintsFromData", "otherBuilder"))).toThrow();
  });
});
