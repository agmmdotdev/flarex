import { beforeAll, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { cartShippingPricingContext } from "../src/modules/pricing/cart-shipping-context";
import { prepareVariantItemPricingContext, calculateLogicalPrices } from "../src/modules/pricing/calculation";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { workflowModuleDefinition } from "../src/workflow/module";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";
import { promiseFailureObserver } from "./support/promise-failure-observer";

const policy = Result.getOrThrow(cartShippingPricingContext);
const opaque = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`custom_${index}`, index]));
const native = Object.fromEntries(policy.fields.map(field => [field, 1]));
const context = { ...native, ...opaque(policy.opaqueMaximum), currency_code: "usd", quantity: 1 };
let pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
beforeAll(async () => { pricing = await runEffect(makeLocalPricingCommands("cart-shipping")); });

it("derives Shipping capacity from the actual native selected Cart family without opening arbitrary extra metadata", () => {
  expect(policy.maximum).toBe(policy.opaqueMaximum + policy.fields.length);
  expect(policy.fields).toEqual(expect.arrayContaining(["items.unit_price", "items.raw_unit_price.value", "items.subtotal", "items.raw_total.precision",
    "items.variant.weight", "shipping_address.country_code", "shipping_address.created_at"]));
  expect(policy.fields).not.toContain("items.metadata.custom");
  expect(policy.fields).not.toContain("shipping_address.metadata.custom");
  expect(Result.getOrThrow(prepareVariantItemPricingContext(context, "cart-shipping"))).toEqual(context);
  expect(prepareVariantItemPricingContext(context, "cart-mutations")).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(Result.getOrThrow(prepareVariantItemPricingContext({ currency_code: "usd", items: [{ unit_price: 1, raw_unit_price: { value: "1", precision: 20 } }] }, "cart-shipping")))
    .toEqual({ currency_code: "usd", "items.unit_price": [1], "items.raw_unit_price.value": ["1"], "items.raw_unit_price.precision": [20] });
  expect(prepareVariantItemPricingContext({ ...context, extra: 1 }, "cart-shipping")).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(prepareVariantItemPricingContext({ currency_code: "usd", ...opaque(65) }, "cart-shipping"))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  console.log("Native Cart Shipping Pricing context capacity", { nativeFields: policy.fields.length, opaque: policy.opaqueMaximum, total: policy.maximum });
});

it.each([["variant-item-pricing", 10], ["cart-creation", 17], ["cart-mutations", 64]] as const)(
  "retains the exact existing %s context boundary", (profile, maximum) => {
    expect(Result.isSuccess(prepareVariantItemPricingContext({ currency_code: "usd", quantity: 1, ...opaque(maximum) }, profile))).toBe(true);
    expect(prepareVariantItemPricingContext({ currency_code: "usd", ...opaque(maximum + 1) }, profile))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });

it("checks the same capacity before native indexed reads and when authenticating both named read receipts", async () => {
  const reads: unknown[] = [];
  const unused = () => Effect.fail(commerceError("unsupportedProfile"));
  const ctx: CommerceCommandContext = { resources: defaultCommerceResources, recordFailure: promiseFailureObserver(), refuse: Effect.fail,
    get manager(): never { throw new Error("Context admission must not acquire a manager"); },
    get store(): never { throw new Error("Context admission must not acquire a store"); },
    table: name => { reads.push(name); return unused(); }, captureLocalEvent: unused, nested: unused, rejectEvent: unused(), borrow: unused };
  expect(await runEffect(calculateLogicalPrices(ctx, { filters: { id: [] }, pricingContext: { context } }, "cart-shipping"))).toEqual([]);
  expect(await runEffectFailure(calculateLogicalPrices(ctx, { filters: { id: [] }, pricingContext: { context: { ...context, extra: 1 } } }, "cart-shipping")))
    .toHaveProperty("reason", "limitExceeded");
  expect(reads).toEqual([]);
  const logical = workflowModuleDefinition(pricing.workflow)?.logical;
  if (logical === undefined) throw new Error("Missing named Pricing policy");
  const activity = { mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] };
  for (const [command, name, input] of [[pricing.calculate, "pricingCalculateCartShipping", { filters: { id: [] }, pricingContext: { context } }],
    [pricing.count, "pricingCartShippingCount", { filters: { id: [], context }, config: { select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: 4 } }]] as const) {
    const call = { commandName: name, mode: "read" as const, input, result: name === "pricingCalculateCartShipping" ? [] : [[], 0],
      events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
    await runEffect(logical.validateLogicalCall(call, activity, command));
    const overflow = name === "pricingCalculateCartShipping" ? { filters: { id: [] }, pricingContext: { context: { ...context, extra: 1 } } }
      : { filters: { id: [], context: { ...context, extra: 1 } }, config: { select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: 4 } };
    expect(await runEffectFailure(logical.validateLogicalCall({ ...call, input: overflow }, activity, command))).toHaveProperty("reason", "receiptMismatch");
  }
});
