// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cartPromotionStepSourcePairs, cartPromotionStepAuthoredTarget, verifyCartPromotionStepSource, verifyCartPromotionStepSelection } from "./check-medusa-cart-promotion-step-source.mjs";
const pair = cartPromotionStepSourcePairs[0];
if (pair === undefined) throw new Error("Missing native Cart promotion source pair");
const original = readFileSync(pair.source, "utf8"), target = readFileSync(pair.target, "utf8"), helper = readFileSync(cartPromotionStepAuthoredTarget, "utf8");
const selected = [pair, { target: cartPromotionStepAuthoredTarget, classification: "authored" }];
describe("exact native Cart promotion step correction", () => {
  it("authenticates the original and the complete corrected native selection and inverse", () => {
    expect(() => verifyCartPromotionStepSource(original, target, helper, pair.target)).not.toThrow();
    expect(() => verifyCartPromotionStepSelection(selected)).not.toThrow();
  });
  it.each([
    ["PromotionActions.ADD", "PromotionActions.REMOVE"],
    ["promotionLinkMap.has(promotion.id)", "true"],
    ["action: \"dismiss\"", "action: \"create\""],
    ["mutations.push", "mutations.unshift"],
    ["cache: { enable: true }", "cache: { enable: false }"],
    ["compensatePreimageOperation(handle)", "compensatePreimageOperation(undefined)"],
  ])("refuses native behavior drift: %s", (before, after) => {
    const changed = target.replace(before, after); expect(changed).not.toBe(target);
    expect(() => verifyCartPromotionStepSource(original, changed, helper, pair.target)).toThrow("Changed native Cart Promotion step source");
  });
  it("refuses identity, terminal-state and lost-response inverse drift", () => {
    for (const [before, after] of [["medusa.cart-promotion-link-operation", "medusa.api-key-link-operation"],
      ['result.state !== "applied"', 'result.state === "applied"'], ["new StepResponse(handle)", "new StepResponse(null)"]]) {
      if (before === undefined || after === undefined) throw new Error("Missing exact guard mutation");
      const changed = helper.replace(before, after); expect(changed).not.toBe(helper);
      expect(() => verifyCartPromotionStepSource(original, target, changed, pair.target)).toThrow("Changed native Cart Promotion step source");
    }
  });
  it("rejects unselected native sources, destinations, classifications and extra statements", () => {
    expect(() => verifyCartPromotionStepSource(original + "\nthrow Error();", target, helper, pair.target)).toThrow();
    expect(() => verifyCartPromotionStepSource(original, target, helper, pair.target + ".adjacent")).toThrow();
    expect(() => verifyCartPromotionStepSource(original, target + "\nthrow Error();", helper, pair.target)).toThrow();
    for (const files of [[], selected.slice(0, 1), [...selected, pair], [{ ...pair, classification: "authored" }, selected[1]],
      [...selected, { ...pair, target: pair.target + ".adjacent" }]]) {
      expect(() => verifyCartPromotionStepSelection(files)).toThrow();
    }
  });
});
