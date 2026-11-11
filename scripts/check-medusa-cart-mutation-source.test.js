import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cartMutationSourcePairs, verifyCartMutationSource, verifyCartMutationSourceSelection, verifyCartMutationOperationSelection } from "./check-medusa-cart-mutation-source.mjs";

const read = file => readFileSync(file, "utf8");
const selected = () => cartMutationSourcePairs.map(pair => ({ ...pair }));
const refusal = pair => pair.target === "packages/medusa-utils/src/common/remove-undefined.ts"
  ? "Changed native undefined-omission type adaptation" : "Changed native Cart mutation algorithm or import";

describe("native Cart mutation source preservation", () => {
  it("retains one source-counted shared mutation allowance and unchanged creation/participant resource bounds", () => {
    const mutation = read("packages/medusa-adapter/src/workflows/cart/mutations.ts");
    const creation = read("packages/medusa-adapter/src/workflows/cart/create-owned.ts");
    expect(() => verifyCartMutationOperationSelection(mutation, creation)).not.toThrow();
    for (const [before, after] of [["cartMutationRequestCallLimit = 1065", "cartMutationRequestCallLimit = 4096"],
      ["cartMutationRequestCallLimit = 1065", "cartMutationRequestCallLimit = 512"],
      ["requestCallLimit: cartMutationRequestCallLimit", "requestCallLimit: cartCreationResources.calls"],
      ["logicalResources: cartCreationResources", "logicalResources: { ...cartCreationResources, calls: 1065 }"],
      ["const cartMutationRequestCallLimit", "let cartMutationRequestCallLimit"]]) {
      expect(mutation).toContain(before);
      expect(() => verifyCartMutationOperationSelection(mutation.replace(before, after), creation)).toThrow();
    }
    expect(() => verifyCartMutationOperationSelection(mutation, creation.replace("calls: 512", "calls: 1065"))).toThrow();
  });
  it("authenticates the entire selected native closure and its retained inverse bodies", () => {
    verifyCartMutationSourceSelection(selected());
    expect(cartMutationSourcePairs).toHaveLength(23);
    for (const pair of cartMutationSourcePairs) verifyCartMutationSource(read(pair.source), read(pair.target), pair.target);
  });

  it("rejects missing, duplicated, redirected and reclassified source pairs", () => {
    const pair = cartMutationSourcePairs[0];
    expect(pair).toBeDefined();
    for (const altered of [selected().slice(1), [...selected(), { ...pair }],
      selected().map((entry, index) => index !== 0 ? entry : { ...entry, source: entry.source + "-adjacent" }),
      selected().map((entry, index) => index !== 0 ? entry : { ...entry, target: entry.target + "-adjacent" }),
      selected().map((entry, index) => index !== 0 ? entry : { ...entry, classification: "authored" }),
      [...selected(), { source: "third_party/medusa/upstream/adjacent.ts", target: "packages/medusa-core-flows/src/adjacent.ts", classification: "cartMutationFork" }],
    ]) expect(() => verifyCartMutationSourceSelection(altered)).toThrow();
    expect(() => verifyCartMutationSource(read(pair.source), read(pair.target), pair.target + "-adjacent"))
      .toThrow("Unselected native Cart mutation source");
  });

  it.each([
    ["cart/workflows/update-cart.ts", "CartWorkflowEvents.UPDATED", "CartWorkflowEvents.CREATED"],
    ["cart/workflows/add-to-cart.ts", "timeout: 2", "timeout: 20"],
    ["cart/workflows/update-line-item-in-cart.ts", "MathBN.eq(input.update.quantity, 0)", "MathBN.eq(input.update.quantity, 1)"],
    ["line-item/workflows/delete-line-items.ts", "deleteLineItemsStep(input.ids)", "deleteLineItemsStep([])"],
    ["line-item/steps/delete-line-items.ts", "service.restoreLineItems(ids)", "service.softDeleteLineItems(ids)"],
    ["cart/steps/get-line-item-actions.ts", "deepEqualObj(existingItem?.metadata, item.metadata)", "true"],
    ["cart/steps/get-line-item-actions.ts", "))!.json", "))!.numeric"],
    ["cart/workflows/add-to-cart.ts", "idempotent: false", "idempotent: true"],
  ])("refuses changed native business/control/inverse behavior in %s", (suffix, before, after) => {
    const pair = cartMutationSourcePairs.find(pair => pair.target.endsWith(suffix));
    expect(pair).toBeDefined();
    const target = read(pair.target);
    expect(target).toContain(before);
    expect(() => verifyCartMutationSource(read(pair.source), target.replace(before, after), pair.target))
      .toThrow("Changed native Cart mutation algorithm or import");
  });

  it("rejects unenumerated runtime imports and extra effects", () => {
    for (const pair of cartMutationSourcePairs) {
      const target = read(pair.target);
      expect(() => verifyCartMutationSource(read(pair.source), 'import "unadmitted-cart-effect";\n' + target, pair.target))
        .toThrow(refusal(pair));
      expect(() => verifyCartMutationSource(read(pair.source), target + '\nthrow new Error("unadmitted-cart-effect");\n', pair.target))
        .toThrow(refusal(pair));
    }
  });

  it("preserves the exact native undefined-omission body and its declared key optionality", () => {
    const pair = cartMutationSourcePairs.find(pair => pair.target === "packages/medusa-utils/src/common/remove-undefined.ts");
    expect(pair).toBeDefined();
    const target = read(pair.target);
    for (const [before, after] of [["JSON.stringify(obj)", "JSON.stringify({})"],
      ["undefined extends T[Key]", "null extends T[Key]"], ["Exclude<T[Key], undefined>", "T[Key]"]]) {
      expect(target).toContain(before);
      expect(() => verifyCartMutationSource(read(pair.source), target.replace(before, after), pair.target))
        .toThrow("Changed native undefined-omission type adaptation");
    }
  });
});
