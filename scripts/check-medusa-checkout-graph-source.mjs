// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const checkoutLinks = ["order-cart", "cart-promotion", "readonly/cart-customer", "readonly/cart-region", "readonly/cart-product"];
export const checkoutGraphAuthoredTargets = Object.freeze([
  "packages/medusa-promotion/src/utils/compute-actions/build-promotion-rule-query-filter-from-context.ts",
]);
export const checkoutGraphSourcePairs = [
  ...checkoutLinks.map(name => ({ source: "third_party/medusa/upstream/packages/modules/link-modules/src/definitions/" + name + ".ts",
    target: "packages/medusa-link-modules/src/definitions/" + name + ".ts", classification: "importRelocation" })),
  ...["services/promotion-module.ts", "services/index.ts", "static-manifest.ts"].map(name => ({
    source: "third_party/medusa/upstream/packages/modules/promotion/src/" + name,
    target: "packages/medusa-promotion/src/" + name,
    classification: name === "services/promotion-module.ts" ? "promotionServiceFork" : "importRelocation" })),
];
/** @param {string} source */
const normalize = source => source.replaceAll("\r\n", "\n").trim();
/** @param {string} source */
const relocate = source => normalize(source.replaceAll('"@medusajs/framework/utils"', '"@medusajs/framework/utils/portable"'));
/** @type {ReadonlyArray<readonly [string, string]>} */
const returns = [["createPromotions_", "Promotion"], ["updatePromotions_", "Promotion"], ["updatePromotionRules_", "PromotionRule"],
  ["createCampaigns_", "Campaign"], ["updateCampaigns_", "Campaign"]];

/** @param {string} source */
export function expectedPromotionService(source) {
  let result = relocate(source);
  for (const [name, model] of returns) {
    const declaration = new RegExp("(protected async " + name + "\\([\\s\\S]*?\\n  \\)) \\{");
    if (!declaration.test(result)) throw new Error("Missing pinned Promotion declaration: " + name);
    result = result.replace(declaration, "$1: Promise<InferEntityType<typeof " + model + ">[]> {");
  }
  return result;
}
/** @param {string} source @param {string} target */
export function verifyPromotionService(source, target) {
  if (expectedPromotionService(source) !== normalize(target)) throw new Error("Native Promotion service drift");
}
/** @param {string} source @param {string} target */
export function verifyNativeCheckoutLink(source, target) {
  if (relocate(source) !== normalize(target)) throw new Error("Native checkout Link drift");
}
/** @param {readonly { source?: string; target: string; classification: string }[]} files */
export function verifyCheckoutGraphSelection(files) {
  for (const target of checkoutGraphAuthoredTargets) {
    const selected = files.filter(file => file.target === target);
    if (selected.length !== 1 || selected[0]?.source !== undefined || selected[0]?.classification !== "authored")
      throw new Error("Redirected native checkout graph source");
  }
  for (const pair of checkoutGraphSourcePairs) {
    const selected = files.filter(file => file.target === pair.target);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.classification !== pair.classification)
      throw new Error("Redirected native checkout graph source");
  }
  for (const file of files) if (checkoutGraphSourcePairs.some(pair => pair.source === file.source ||
    file.classification === "promotionServiceFork") && !checkoutGraphSourcePairs.some(pair =>
      file.source === pair.source && file.target === pair.target && file.classification === pair.classification))
    throw new Error("Redirected native checkout graph source");
}
export const promotionSqlPrefilterGate = `import type { Context, DAL, PromotionTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils/portable"

/** The native SQL prefilter requires a MikroORM manager. This bounded read
 * profile exposes no promotion computation or database-manager capability. */
export async function buildPromotionRuleQueryFilterFromContext(
  _context: PromotionTypes.ComputeActionContext, _sharedContext: Context
): Promise<DAL.FilterQuery<unknown> | null> {
  throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Promotion SQL prefilter is outside the checkout read profile")
}`;

/** @param {string} target */
export function verifyPromotionSqlPrefilter(target) {
  if (normalize(target) !== promotionSqlPrefilterGate.trim()) throw new Error("Promotion SQL prefilter refusal drift");
}

export function checkCheckoutGraphSource(root = process.cwd()) {
  /** @param {string} path */
  const read = path => readFileSync(resolve(root, path), "utf8");
  for (const name of checkoutLinks) verifyNativeCheckoutLink(
    read("third_party/medusa/upstream/packages/modules/link-modules/src/definitions/" + name + ".ts"),
    read("packages/medusa-link-modules/src/definitions/" + name + ".ts"));
  verifyPromotionService(read("third_party/medusa/upstream/packages/modules/promotion/src/services/promotion-module.ts"),
    read("packages/medusa-promotion/src/services/promotion-module.ts"));
  verifyNativeCheckoutLink(read("third_party/medusa/upstream/packages/modules/promotion/src/static-manifest.ts"),
    read("packages/medusa-promotion/src/static-manifest.ts"));
  verifyNativeCheckoutLink(read("third_party/medusa/upstream/packages/modules/promotion/src/services/index.ts"),
    read("packages/medusa-promotion/src/services/index.ts"));
  verifyPromotionSqlPrefilter(read("packages/medusa-promotion/src/utils/compute-actions/build-promotion-rule-query-filter-from-context.ts"));
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkCheckoutGraphSource();
  console.log("Native checkout graph sources retained");
}
