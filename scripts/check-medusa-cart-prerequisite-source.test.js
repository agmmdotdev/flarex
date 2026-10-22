// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cartPrerequisiteSourcePairs, workflowCacheSourcePairs, customerSelectionSourcePairs, verifyCustomerSelectionFork, verifyWorkflowCacheFork, verifyCartPrerequisiteSourceSelection, verifyPaymentJoinerFork } from "./check-medusa-cart-prerequisite-source.mjs";
import { verifyModuleTypeFork } from "./check-medusa-currency-promotion.mjs";
import { verifyTestPort } from "./check-medusa-test-port.mjs";

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

describe("native Customer selection source contracts", () => {
  it("selects only the genuine step, email validator and original email tests", () => {
    expect(customerSelectionSourcePairs.map(pair => [pair.target, pair.classification])).toEqual([
      ["packages/medusa-core-flows/src/cart/steps/find-or-create-customer.ts", "customerSelectionFork"],
      ["packages/medusa-utils/src/common/is-email.ts", "unchanged"],
      ["packages/medusa-utils/src/common/__tests__/is-email.spec.ts", "testPort"],
    ]);
  });
  it.each(customerSelectionSourcePairs.filter(pair => pair.classification !== "testPort"))("preserves complete typed and emitted $target", pair => {
    const selected = entry(pair.target);
    expect(() => verifyCustomerSelectionFork(selected.native, selected.actual, selected.target)).not.toThrow();
  });
  it.each([
    ["if (!isDefined(data.customerId) && !isDefined(data.email))", "if (false)"],
    ["          customer: undefined,\n", ""],
    ["service.retrieveCustomer(customerId)", 'service.retrieveCustomer("other")'],
    ["return await useCache<CustomerDTO>(", "return await Promise.resolve<CustomerDTO>("],
    ["service.listCustomers(filters)", "service.listCustomers({ email })"],
    ['key: ["find-or-create-customer-by-id", customerId]', 'key: ["other", customerId]'],
    ["if (data.customerId)", "if (false)"],
    ["validateEmail(data.email)", "data.email"],
    [": await fetchCustomersByEmail(validatedEmail, container)", ": (await fetchCustomersByEmail(validatedEmail, container)).reverse()"],
    ["if (customer?.has_account)", "if (customer)"],
    ["          container,\n          false", "          container,\n          true"],
    ["service.createCustomers({ email: validatedEmail })", "service.createCustomers([{ email: validatedEmail }])"],
    ["customerWasCreated = true", "customerWasCreated = false"],
    ["if (!customerWasCreated || !customer?.id)", "if (!customer?.id)"],
    ["service.deleteCustomers(customer.id)", "service.deleteCustomers([customer.id])"],
    ["service.deleteCustomers(customer.id)", 'service.deleteCustomers("other")'],
    ['compensation: "transactionCovered"', 'compensation: "other"'],
    ["  StepCompensateInput\n>(", "  unknown\n>("],
    ["  customer?: CustomerDTO | null | undefined\n", "  customer?: CustomerDTO\n"],
  ])("refuses changed selection, cache, retained shape or compensation: %s", (before, after) => {
    const selected = entry("packages/medusa-core-flows/src/cart/steps/find-or-create-customer.ts");
    const changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyCustomerSelectionFork(selected.native, changed, selected.target)).toThrow(failure);
  });
  it("refuses moving validation after the native account return", () => {
    const selected = entry("packages/medusa-core-flows/src/cart/steps/find-or-create-customer.ts");
    const validation = "      const validatedEmail = (data.email && validateEmail(data.email)) as string\n\n";
    const changed = selected.actual.replace(validation, "").replace("      if (customer && customer.email !== validatedEmail)",
      validation + "      if (customer && customer.email !== validatedEmail)");
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyCustomerSelectionFork(selected.native, changed, selected.target)).toThrow(failure);
  });
  it.each([
    ["email.toLowerCase().match(EMAIL_REGEX)", "email.trim().toLowerCase().match(EMAIL_REGEX)"],
    ["return email.toLowerCase()", "return email"],
    ["if (!validatedEmail)", "if (false)"],
    ['"The email is not valid"', '"Other error"'],
    ["email: string", "email: unknown"],
  ])("refuses changed native email runtime or erased contract: %s", (before, after) => {
    const selected = entry("packages/medusa-utils/src/common/is-email.ts"), changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyCustomerSelectionFork(selected.native, changed, selected.target)).toThrow(failure);
  });
  it("retains every original email test through the existing test-port owner", () => {
    const selected = entry("packages/medusa-utils/src/common/__tests__/is-email.spec.ts");
    expect(() => verifyTestPort(selected.native, selected.actual)).not.toThrow();
    expect(() => verifyTestPort(selected.native, selected.actual.replace('"The email is not valid"', '"Other error"'))).toThrow();
    expect(() => verifyTestPort(selected.native, selected.actual.replace("expect.assertions(1)", "expect.assertions(0)"))).toThrow();
  });
  it("refuses redirecting the Customer fork to an unrelated owner", () => {
    const selected = entry("packages/medusa-core-flows/src/cart/steps/find-or-create-customer.ts");
    expect(() => verifyCustomerSelectionFork(selected.native, selected.actual, "packages/medusa-core-flows/src/cart/steps/find-sales-channel.ts")).toThrow(failure);
  });
});

describe("native shared workflow cache source contracts", () => {
  it.each(workflowCacheSourcePairs.filter(pair => pair.classification === "workflowCacheFork"))("preserves complete typed and emitted $target", pair => {
    const selected = entry(pair.target);
    expect(() => verifyWorkflowCacheFork(selected.native, selected.actual, pair.target)).not.toThrow();
  });
  it.each(workflowCacheSourcePairs.filter(pair => pair.classification === "unchanged"))("preserves exact native $target", pair => {
    const selected = entry(pair.target);
    expect(selected.actual).toBe(selected.native);
  });
  it("keeps the prerequisite to its exact cache and type closure", () => {
    expect(workflowCacheSourcePairs).toHaveLength(4);
    expect(workflowCacheSourcePairs.every(pair => !pair.target.startsWith("packages/medusa-core-flows/"))).toBe(true);
    expect(new Set(workflowCacheSourcePairs.map(pair => pair.target)).size).toBe(4);
  });
  it.each([
    ["packages/medusa-utils/src/caching/index.ts", "allowUnregistered: true", "allowUnregistered: false"],
    ["packages/medusa-utils/src/caching/index.ts", "Modules.CACHING,", '"other_cache",'],
    ["packages/medusa-utils/src/caching/index.ts", "!options.enable ||", "options.enable ||"],
    ["packages/medusa-utils/src/caching/index.ts", "  const cachingModule = options.container.resolve<ICachingModuleService>(",
      "  if (!options.enable) return await cb()\n\n  const cachingModule = options.container.resolve<ICachingModuleService>("],
    ["packages/medusa-utils/src/caching/index.ts", "return await cb()", "return undefined"],
    ["packages/medusa-utils/src/caching/index.ts", "return await cb()", "return await cb(options)"],
    ["packages/medusa-utils/src/caching/index.ts", "const cachingModule = options.container.resolve<ICachingModuleService>(", "const cachingModule = undefined; options.container.resolve<ICachingModuleService>("],
    ["packages/medusa-utils/src/caching/index.ts", "const result = await cb()", "const result = cb()"],
    ["packages/medusa-utils/src/feature-flags/flag-router.ts", "return flags.every", "return flags.some"],
  ])("refuses changed native resolution, callback or flag behavior in %s", (target, before, after) => {
    const selected = entry(target), changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyWorkflowCacheFork(selected.native, changed, target)).toThrow(failure);
  });
  it("refuses broader erased declarations as well as runtime mutations", () => {
    const selected = entry("packages/medusa-utils/src/caching/index.ts");
    expect(() => verifyWorkflowCacheFork(selected.native, selected.actual.replace("allowUnregistered: true }): T | undefined", "allowUnregistered: boolean }): T"), selected.target)).toThrow(failure);
  });
});

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
