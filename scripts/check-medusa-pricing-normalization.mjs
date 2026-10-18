// @ts-check

const message = "Changed native Pricing normalization extraction";
const header = `/** Storage-independent native Pricing normalization extracted unchanged from
 * packages/modules/pricing/src/services/pricing-module.ts at
 * 48d5cc675e4e8bc821e22c20c88a751acc66fb5f. */
import type { CreatePricesDTO, CreatePriceRuleDTO, PricingRuleOperatorValues, PricingTypes } from "@medusajs/framework/types"
import { isPresent, MedusaError, PricingRuleOperator, removeNullish } from "@medusajs/framework/utils/portable"
import type { ServiceTypes } from "./types"

`;
/** @param {string} value */
const lf = value => value.replaceAll("\r\n", "\n");
/** @param {string} source @param {string} start @param {string} end */
function block(source, start, end) {
  const offset = source.indexOf(start), finish = source.indexOf(end, offset + start.length);
  if (offset < 0 || finish < 0 || source.indexOf(start, offset + start.length) !== -1) throw new Error(message);
  return source.slice(offset, finish);
}

/** Authenticate both unchanged algorithm bodies and the original owner's
 * delegation. Return the service with only this extraction reversed, so the
 * enclosing promotion verifier can still police all unrelated adaptations.
 * @param {string} source @param {string} target @param {string} helper
 * @returns {string}
 */
export function verifyPricingNormalizationExtraction(source, target, helper) {
  source = lf(source); target = lf(target); helper = lf(helper);
  const method = block(source, "  private normalizePrices(", "\n  async addPrices("),
    hash = block(source, "const hashPrice = (", "\n/**\n * Build targeted database constraints");
  const functionBody = method.split("\n").map(line => line.startsWith("  ") ? line.slice(2) : line).join("\n")
    .replace("private normalizePrices(", "export function normalizePrices(").trimEnd();
  if (helper !== header + functionBody + "\n\n" + hash.trimEnd() + "\n")
    throw new Error(message);
  const signatureEnd = method.indexOf("  ) {") + "  ) {".length;
  if (signatureEnd < "  ) {".length) throw new Error(message);
  const wrapper = method.slice(0, signatureEnd) + "\n    return normalizePricingPrices(data, existingPrices, priceListId)\n  }\n";
  const adapted = block(target, "  private normalizePrices(", "\n  async addPrices(");
  const imported = 'import { normalizePrices as normalizePricingPrices } from "../normalization"\n';
  if (adapted !== wrapper || !target.includes(imported) || target.includes("const hashPrice = (")) throw new Error(message);
  const hashAnchor = "/**\n * Build targeted database constraints";
  let reversed = target.replace(adapted, method).replace(imported, "").replace(hashAnchor, hash + "\n" + hashAnchor);
  for (const [anchor, restored] of [
    ["  CreatePricePreferenceDTO,\n", "  CreatePriceRuleDTO,\n"],
    ["  PricingRepositoryService,\n", "  PricingRuleOperatorValues,\n"],
    ["  PriceListType,\n", "  PricingRuleOperator,\n"],
  ]) {
    if (!reversed.includes(anchor) || reversed.includes(restored)) throw new Error(message);
    reversed = reversed.replace(anchor, anchor + restored);
  }
  return reversed;
}
