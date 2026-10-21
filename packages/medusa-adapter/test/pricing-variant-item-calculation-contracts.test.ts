import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { validatePricingCurrencyCode } from "@medusajs/pricing/calculation";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { decodePricingCalculation, decodeVariantItemPricingCalculation, prepareVariantItemPricingContext, VariantItemPricingCalculationOutput } from "../src/modules/pricing/calculation";
import { commerceDecoder } from "../src/value/decoder";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";

const context = { id: "cart159-input", currency_code: "usd", region_id: "reg159-input", customer_id: "cus159-input",
  quantity: 1, is_custom_price: false };
const input = (value: unknown) => ({ filters: { id: ["price-set"] }, pricingContext: { context: value } });
const output = commerceDecoder(VariantItemPricingCalculationOutput, "storedCorruption");
const price = { id: "price", price_list_id: null, price_list_type: null, min_quantity: null, max_quantity: null };
const complete = { id: "price-set", is_calculated_price_price_list: false, is_calculated_price_tax_inclusive: false,
  calculated_amount: 10.25, raw_calculated_amount: { value: "10.25", precision: 20 },
  is_original_price_price_list: false, is_original_price_tax_inclusive: true,
  original_amount: 20.5, raw_original_amount: { value: "20.5", precision: 20 }, currency_code: "usd",
  calculated_price: price, original_price: { ...price, id: "original-price" } };

describe("native Variant/item Pricing contracts", () => {
  it.each([undefined, null, "", false, 0])("retains the original required-currency business error for %s", currency => {
    let failure: unknown;
    try { validatePricingCurrencyCode(currency); } catch (cause) { failure = cause; }
    expect(failure).toBeInstanceOf(MedusaError);
    expect(failure).toMatchObject({ type: MedusaError.Types.INVALID_DATA,
      message: "Method calculatePrices requires currency_code in the pricing context" });
  });

  it("accepts native supplied currency and keeps optional currency transport separate from calculation", () => {
    expect(validatePricingCurrencyCode("usd")).toBeUndefined();
    expect(Result.getOrThrow(decodeVariantItemPricingCalculation(input({ quantity: 1, is_custom_price: false }))))
      .toEqual(input({ quantity: 1, is_custom_price: false }));
    expect(Result.getOrThrow(decodePricingCalculation(input({ quantity: 1 })))).toEqual(input({ quantity: 1 }));
  });

  it("binds only native calculatePrices and the genuine Price Set graph count in its named read-only profile", async () => {
    const pricing = await Effect.runPromise(makeLocalPricingCommands("variant-item-pricing"));
    expect(pricing.commands).toEqual([pricing.count, pricing.calculate]);
    expect(pricing.commands.map(command => commerceCommandIdentity(command)?.mode)).toEqual(["read", "read"]);
    expect(Object.keys(pricing.workflow.methods)).toEqual(["calculatePrices"]);
    const token = pricing.workflow.methods.calculatePrices;
    if (token === undefined) throw new Error("Missing native Pricing calculation method");
    const method = workflowMethodDefinition(token);
    if (method === undefined) throw new Error("Missing native Pricing calculation definition");
    expect(method.command).toBe(pricing.calculate); expect(method.moduleEvents).toEqual([]);
    expect(Result.getOrThrow(method.input([{ id: ["price-set"] }, { context }]))).toEqual(input(context));
    expect(Result.getOrThrow(method.output([complete]))).toEqual([complete]);
    expect(workflowModuleDefinition(pricing.workflow)?.source).toEqual({ name: "flarex-pricing-local", profile: "pricing-variant-item-pricing" });
    expect(pricing.graph.reads.map(read => [read.model, read.command, read.paths])).toEqual([["PriceSet", pricing.count, []]]);
  });

  it("preserves the original scalar refusal witness and accepts the complete native callback context separately", () => {
    expect(decodePricingCalculation(input(context))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.getOrThrow(decodeVariantItemPricingCalculation(input(context)))).toEqual(input(context));
    const nested = { ...context, customer: { groups: [{ id: "vip" }, { id: "member" }] }, flags: [false, true], absent: null };
    expect(decodePricingCalculation(input(nested))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.getOrThrow(decodeVariantItemPricingCalculation(input(nested)))).toEqual(input(nested));
    expect(Result.getOrThrow(decodePricingCalculation(input({ currency_code: "usd", quantity: 1 })))).toEqual(input({ currency_code: "usd", quantity: 1 }));
  });

  it("checks every native result field before exposing a selected amount", () => {
    expect(Result.getOrThrow(output([complete]))).toEqual([complete]);
    expect(Result.getOrThrow(output([]))).toEqual([]);
    for (const key of Object.keys(complete)) {
      const partial = Object.fromEntries(Object.entries(complete).filter(([name]) => name !== key));
      expect(output([partial])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    }
    for (const invalid of [{ ...complete, calculated_amount: Infinity }, { ...complete, original_amount: "20.5" },
      { ...complete, calculated_price: { ...price, price_list_type: "other" } },
      { ...complete, original_price: { id: "original-price" } },
      { ...complete, raw_original_amount: { value: "20.5" } },
      { ...complete, extra: true },
    ]) expect(output([invalid])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("uses native flattening without dropping boolean or array values and bounds ten non-control attributes", () => {
    const nested = { ...context, customer: { groups: [{ id: "vip" }, { id: "member" }] }, flags: [false, true], absent: null };
    const before = structuredClone(nested);
    expect(Result.getOrThrow(prepareVariantItemPricingContext(nested))).toEqual({ ...context,
      "customer.groups.id": ["vip", "member"], flags: [false, true] });
    expect(nested).toEqual(before);
    const maximum = { currency_code: "usd", quantity: 1,
      ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => ["attribute-" + index, "value"])) };
    expect(Result.getOrThrow(prepareVariantItemPricingContext(maximum))).toEqual(maximum);
    expect(prepareVariantItemPricingContext({ ...maximum, eleventh: true }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });

  it("retains native nulls and the independently represented exact raw amount", () => {
    const rounded = { ...complete, calculated_amount: 9007199254740992, raw_calculated_amount: { value: "9007199254740993.125", precision: 30 } };
    expect(Result.getOrThrow(output([rounded]))).toEqual([rounded]);
    const missingOriginal = { ...complete, original_amount: null, raw_original_amount: null,
      original_price: { ...price, id: null }, is_original_price_tax_inclusive: false };
    expect(Result.getOrThrow(output([missingOriginal]))).toEqual([missingOriginal]);
  });
});
