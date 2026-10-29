// @ts-check
import { createHash } from "node:crypto";
export const cartPromotionStepSourcePairs = Object.freeze([Object.freeze({
  source: "third_party/medusa/upstream/packages/core/core-flows/src/cart/steps/update-cart-promotions.ts", target: "packages/medusa-core-flows/src/cart/steps/update-cart-promotions.ts", classification: "workflowFork",
})]);
export const cartPromotionStepAuthoredTarget = "packages/medusa-core-flows/src/cart/utils/promotion-link-operation.ts";
const failure = "Changed native Cart Promotion step source";
const digest = /** @param {string} text */ text => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
/** Exact reviewed native-owner correction. The original pinned source remains
 * authenticated independently; no neighboring workflow gains fork permission.
 * @param {string} source @param {string} target @param {string} helper @param {string} destination */
export function verifyCartPromotionStepSource(source, target, helper, destination) {
  if (destination !== cartPromotionStepSourcePairs[0]?.target || digest(source) !== "87cabe05405d35f8d0be13da2dc62eeafe0ffe8ea6203fa1059e4aecde41d772" ||
    digest(target) !== "95938fec681b9c57fdbbeff8d59257ed2f2a5d1067323f544004c730c9befde4" || digest(helper) !== "fa86ae0d57f4e9034c2e03bd3273059269b60d9e34d672febe994db41a56f45e") throw new Error(failure);
}
/** @param {readonly {target: string, source?: string, classification: string}[]} files */
export function verifyCartPromotionStepSelection(files) {
  const pair = cartPromotionStepSourcePairs[0];
  if (pair === undefined || files.filter(file => file.target === pair.target && file.source === pair.source && file.classification === pair.classification).length !== 1 ||
    files.filter(file => file.target === cartPromotionStepAuthoredTarget && file.source === undefined && file.classification === "authored").length !== 1 ||
    files.some(file => file.source === pair.source && file.target !== pair.target)) throw new Error(failure);
}
