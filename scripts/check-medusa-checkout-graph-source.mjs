// @ts-check
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const checkoutLinks = ["order-cart", "cart-promotion", "readonly/cart-customer", "readonly/cart-region", "readonly/cart-product"];
export const checkoutGraphAuthoredTargets = Object.freeze([
  "packages/medusa-promotion/src/utils/compute-actions/build-promotion-rule-query-filter-from-context.ts",
  "packages/medusa-promotion/src/utils/compute-actions/prefilter.ts",
  "packages/medusa-promotion/src/utils/compute-actions/prefilter-plan.ts",
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
  return result.replace('import { buildPromotionRuleQueryFilterFromContext }',
    'import type { PromotionPrefilterPersistence } from "../utils/compute-actions/prefilter"\nimport { buildPromotionRuleQueryFilterFromContext }')
    .replace("protected readonly moduleDeclaration: InternalModuleDeclaration\n",
      "protected readonly moduleDeclaration: InternalModuleDeclaration,\n    protected readonly prefilterPersistence?: PromotionPrefilterPersistence\n")
    .replace("          applicationContext,\n          sharedContext\n",
      "          applicationContext,\n          sharedContext,\n          this.prefilterPersistence\n");
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
/** Exact approved native owner program, including finite thresholds, the empty
 * disjunction, historical cast cohort and the absent-port refusal. */
/** @type {Readonly<Partial<Record<string, string>>>} */
const promotionPrefilterDigests = {
  "packages/medusa-promotion/src/utils/compute-actions/build-promotion-rule-query-filter-from-context.ts": "56209bd1959622b0f3565b6df57b26d24fd299634b5a4f9711b1762a76f598d2",
  "packages/medusa-promotion/src/utils/compute-actions/prefilter.ts": "0c41b180acfe643b0a047ac3267daa08d420c6d2f6c618be2ae95a63fae58640",
  "packages/medusa-promotion/src/utils/compute-actions/prefilter-plan.ts": "c09ad4b5b3b870baa4ad6e71f0c266fcd1a7e16d9bcb4919ecbc6da118a5c6ab"
};
/** @param {string} target @param {string} [path] */
export function verifyPromotionSqlPrefilter(target, path = checkoutGraphAuthoredTargets[0]) {
  const expected = promotionPrefilterDigests[path];
  if (expected === undefined || createHash("sha256").update(normalize(target)).digest("hex") !== expected)
    throw new Error("Native Promotion prefilter drift");
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
  for (const path of checkoutGraphAuthoredTargets) verifyPromotionSqlPrefilter(read(path), path);
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkCheckoutGraphSource();
  console.log("Native checkout graph sources retained");
}
