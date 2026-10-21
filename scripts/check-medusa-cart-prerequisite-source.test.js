// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cartPrerequisiteSourcePairs, verifyCartPrerequisiteSourceSelection, verifyPaymentJoinerFork } from "./check-medusa-cart-prerequisite-source.mjs";
import { verifyModuleTypeFork } from "./check-medusa-currency-promotion.mjs";

const failure = "Changed native Cart prerequisite source";
/** @param {string} target */
function entry(target) {
  const pair = cartPrerequisiteSourcePairs.find(item => item.target === target);
  if (pair === undefined) throw new Error("Missing Cart prerequisite source " + target);
  return { ...pair, native: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") };
}
const payment = entry("packages/medusa-payment/src/joiner-config.ts");
/** @param {string} before @param {string} after */
function rejectPaymentMutation(before, after) {
  const changed = payment.actual.replace(before, after);
  expect(changed).not.toBe(payment.actual);
  expect(() => verifyPaymentJoinerFork(payment.native, changed)).toThrow(failure);
}

describe("native160 prerequisite source selection", () => {
  it("requires the complete exact prepared closure", () => {
    expect(() => verifyCartPrerequisiteSourceSelection(cartPrerequisiteSourcePairs)).not.toThrow();
    expect(new Set(cartPrerequisiteSourcePairs.map(pair => pair.target)).size).toBe(cartPrerequisiteSourcePairs.length);
    expect(cartPrerequisiteSourcePairs.some(pair => pair.target === "packages/medusa-types/src/customer/common.ts")).toBe(false);
  });
  it("accepts the real promotion manifest including its existing preserved package licenses", () => {
    const manifest = JSON.parse(readFileSync("roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", "utf8"));
    expect(manifest.files).toContainEqual(expect.objectContaining({
      source: "third_party/medusa/upstream/LICENSE", target: "packages/medusa-currency/LICENSE", classification: "preserved",
    }));
    expect(() => verifyCartPrerequisiteSourceSelection(manifest.files)).not.toThrow();
  });
  it.each(["cart", "customer", "tax", "promotion", "payment"])("requires the exact native %s package license", owner => {
    const pair = cartPrerequisiteSourcePairs.find(item => item.target === `packages/medusa-${owner}/LICENSE`);
    expect(pair).toEqual({ source: "third_party/medusa/upstream/LICENSE", target: `packages/medusa-${owner}/LICENSE`, classification: "unchanged" });
    if (pair === undefined) throw new Error("Missing package license");
    expect(readFileSync(pair.target, "utf8")).toBe(readFileSync(pair.source, "utf8"));
  });
  it.each(cartPrerequisiteSourcePairs)("rejects removal of $target", pair => {
    expect(() => verifyCartPrerequisiteSourceSelection(cartPrerequisiteSourcePairs.filter(item => item !== pair))).toThrow(failure);
  });
  it.each(/** @type {const} */ (["source", "target", "classification"]))("rejects changed %s provenance in either direction", field => {
    const pair = cartPrerequisiteSourcePairs[0];
    if (pair === undefined) throw new Error("Missing prerequisite");
    const changed = { ...pair, [field]: pair[field] + ".changed" };
    expect(() => verifyCartPrerequisiteSourceSelection([changed, ...cartPrerequisiteSourcePairs.slice(1)])).toThrow(failure);
    expect(() => verifyCartPrerequisiteSourceSelection([...cartPrerequisiteSourcePairs, changed])).toThrow(failure);
  });
  it("rejects duplicate destinations and redirected source owners", () => {
    const pair = cartPrerequisiteSourcePairs[0];
    if (pair === undefined) throw new Error("Missing prerequisite");
    expect(() => verifyCartPrerequisiteSourceSelection([...cartPrerequisiteSourcePairs, pair])).toThrow(failure);
    expect(() => verifyCartPrerequisiteSourceSelection([...cartPrerequisiteSourcePairs, { ...pair, target: "packages/unrelated/src/copied.ts" }]))
      .toThrow(failure);
  });
  it.each([
    "packages/medusa-cart/src/unlisted.ts",
    "packages/medusa-customer/src/unlisted.ts",
    "packages/medusa-tax/src/unlisted.ts",
    "packages/medusa-payment/src/unlisted.ts",
    "packages/medusa-promotion/src/services/promotion-module.ts",
    "packages/medusa-promotion/src/services/index.ts",
    "packages/medusa-promotion/src/static-manifest.ts",
    "packages/medusa-promotion/src/utils/compute-actions/build-promotion-rule-query-filter-from-context.ts",
  ])("rejects unselected code %s even when marked authored", target => {
    expect(() => verifyCartPrerequisiteSourceSelection([...cartPrerequisiteSourcePairs, { target, classification: "authored" }])).toThrow(failure);
  });
  it("allows existing exact license reuse but no code or classification escape", () => {
    const reused = { source: "third_party/medusa/upstream/LICENSE", target: "packages/medusa-existing/LICENSE", classification: "unchanged" };
    expect(() => verifyCartPrerequisiteSourceSelection([...cartPrerequisiteSourcePairs, reused])).not.toThrow();
    expect(() => verifyCartPrerequisiteSourceSelection([...cartPrerequisiteSourcePairs, { ...reused, classification: "preserved" }])).not.toThrow();
    expect(() => verifyCartPrerequisiteSourceSelection([...cartPrerequisiteSourcePairs, { ...reused, classification: "authored" }])).toThrow(failure);
    expect(() => verifyCartPrerequisiteSourceSelection([...cartPrerequisiteSourcePairs, { ...reused, target: "packages/unrelated/src/license.ts" }]))
      .toThrow(failure);
  });
});

describe("native160 explicit Payment joiner", () => {
  it("preserves complete native options via the authenticated existing wrapper", () => {
    expect(() => verifyPaymentJoinerFork(payment.native, payment.actual)).not.toThrow();
    expect(() => verifyPaymentJoinerFork(payment.native, "/* layout */\n" + payment.actual)).not.toThrow();
  });
  it.each([
    ["model order", "    PaymentCollection,\n    PaymentSession,", "    PaymentSession,\n    PaymentCollection,"],
    ["module", "Modules.PAYMENT,", "Modules.CART,"],
    ["alias", 'name: ["payment_method", "payment_methods"]', 'name: ["payment", "payments"]'],
    ["method suffix", 'methodSuffix: "PaymentMethods"', 'methodSuffix: "Payments"'],
    ["linkable key", "payment_collection_id: PaymentCollection.name", "payment_collection_id: Payment.name"],
    ["helper import", 'from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"', 'from "@medusajs/utils/modules-sdk/joiner-config-builder"'],
    ["helper binding", "import { defineJoinerConfigFromModels }", "import { defineJoinerConfigFromModels as otherBuilder }"],
    ["callee", "= defineJoinerConfigFromModels(", "= defineJoinerConfig("],
    ["portable module import", 'from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
    ["models omission", "models: [", "otherModels: ["],
    ["extra options", "linkableKeys: {", "schema: 'other', linkableKeys: {"],
  ])("rejects changed %s", (_label, before, after) => rejectPaymentMutation(before, after));
  it("rejects absent, dynamic or duplicate native model ownership", () => {
    const mutations = [
      payment.native.replace("models: [", "otherModels: ["),
      payment.native.replace(/models: \[[\s\S]*?\],/, "models: discoverModels(),"),
      payment.native.replace("models: [", "models: [], models: ["),
    ];
    for (const changed of mutations) {
      expect(changed).not.toBe(payment.native);
      expect(() => verifyPaymentJoinerFork(changed, payment.actual)).toThrow(failure);
    }
    expect(() => verifyPaymentJoinerFork(payment.native, payment.actual + "\nexport const other = 1")).toThrow(failure);
  });
});

describe("native160 existing ordinary module parity owner", () => {
  const relocated = cartPrerequisiteSourcePairs.filter(pair => pair.classification === "importRelocation");
  it.each(relocated)("preserves native runtime $target", pair => {
    const selected = entry(pair.target);
    expect(() => verifyModuleTypeFork(selected.native, selected.actual)).not.toThrow();
  });
  it.each([
    ["packages/medusa-cart/src/services/cart-module.ts", "this.cartService_ = cartService", "this.cartService_ = addressService"],
    ["packages/medusa-cart/src/static-manifest.ts", "moduleService: CartModuleService", "moduleService: OtherModuleService"],
    ["packages/medusa-customer/src/static-manifest.ts", "service: CustomerModuleService", "service: OtherModuleService"],
    ["packages/medusa-payment/src/static-manifest.ts", "moduleService: PaymentModuleService", "moduleService: OtherModuleService"],
    ["packages/medusa-cart/src/models/cart.ts", "foreignKey: true", "foreignKey: false"],
  ])("rejects changed service/model/metadata wiring in %s", (target, before, after) => {
    const selected = entry(target), changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyModuleTypeFork(selected.native, changed)).toThrow();
  });
});
