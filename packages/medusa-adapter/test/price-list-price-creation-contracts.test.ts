import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceDecoder } from "../src/value/decoder";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { PriceListPriceCreationWorkflowInput, decodeAddPriceListPrices, decodeNormalizedPriceListPrice,
  compilePriceListPriceCreationContracts } from "../src/modules/pricing/price-list-price-input";

const price = { variant_id: "v155", currency_code: "USD", amount: -1.25 };
const decode = commerceDecoder(PriceListPriceCreationWorkflowInput, "invalidInput");
describe("Price List Price workflow contracts", () => {
  it("preserves raw case, negative fractions, omission, explicit null and empty rule records", () => {
    const input = { data: [{ id: "", prices: [price, { ...price, min_quantity: null, max_quantity: 0, rules: {} }] }] };
    const parsed = Result.getOrThrow(decode(input)); expect(parsed).toEqual(input);
    expect(Object.hasOwn(parsed.data[0]!.prices[0]!, "min_quantity")).toBe(false);
    expect(Object.hasOwn(parsed.data[0]!.prices[1]!, "min_quantity")).toBe(true);
    expect(Result.isSuccess(decode({ data: [] }))).toBe(true);
  });
  it("closes the native input grammar and forward bounds without admitting caller IDs or managed data", () => {
    for (const value of [{ data: [{ id: "p155", prices: [{ ...price, id: "price155" }] }] },
      { data: [{ id: "p155", prices: [{ ...price, amount: Infinity }] }] },
      { data: [{ id: "p155", prices: [{ ...price, rules: { a: "1", b: "2", c: "3" } }] }] },
      { data: [{ id: "p155", prices: [price, price, price] }] }, { data: Array.from({ length: 5 }, () => ({ id: "p155", prices: [] })) }])
      expect(Result.isFailure(decode(value))).toBe(true);
    expect(Result.isFailure(decodeAddPriceListPrices([{ price_list_id: "p155", prices: [price] }]))).toBe(true);
    expect(Result.isFailure(decodeAddPriceListPrices([{ price_list_id: "p155", prices: [{ amount: 1, currency_code: "usd", price_set_id: "s155", created_at: "caller" }] }]))).toBe(true);
  });
  it("admits raw rules:{} but retains native-normalized undeclared-DML refusal as typed invalidInput", () => {
    expect(Result.isSuccess(decodeAddPriceListPrices([{ price_list_id: "p155", prices: [{ amount: 1, currency_code: "usd", price_set_id: "s155", rules: {} }] }]))).toBe(true);
    expect(decodeNormalizedPriceListPrice({ amount: 1, currency_code: "usd", price_set_id: "s155", price_list_id: "p155", rules: {} }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });
  it("checks sparse DTO DML and exact raw shapes without inventing omitted defaults", async () => {
    const contracts = Result.getOrThrow(compilePriceListPriceCreationContracts((await Effect.runPromise(capturePricingMetadata())).frame));
    const output = [{ id: "price155", currency_code: "USD", amount: 1.25, raw_amount: { value: "1.25", precision: 20 }, price_set_id: "s155", price_list_id: "p155" }];
    expect(Result.getOrThrow(contracts.decodeOutput(output))).toEqual(output);
    expect(Result.isFailure(contracts.decodeOutput([{ ...output[0], raw_amount: { value: 1.25, precision: 20 } }]))).toBe(true);
    expect(Result.isFailure(contracts.decodeOutput([{ ...output[0], undeclared: true }]))).toBe(true);
  });
  it("routes native finite quantity equality through the numeric owner and preserves null versus omission", async () => {
    const contracts = Result.getOrThrow(compilePriceListPriceCreationContracts((await Effect.runPromise(capturePricingMetadata())).frame));
    const quantity = (input: unknown) => contracts.compileNativeCandidatePlan(input).pipe(Result.map(plan => plan.rootQuery({ kind: "in", column: "price_set_id", values: ["s155"] })));
    const query = Result.getOrThrow(quantity(buildQuery({ price_list_id: { $in: ["p155"] }, currency_code: "USD", price_set_id: "s155",
      min_quantity: -1.25, max_quantity: null }, { relations: ["price_rules"], order: { id: "ASC" } })));
    expect(query).toMatchObject({ predicate: { kind: "and", children: expect.arrayContaining([{ kind: "and", children: expect.arrayContaining([
      { kind: "numericIn", column: "min_quantity", values: [-1.25] }, { kind: "isNull", column: "max_quantity" },
    ]) }]) } });
    const omitted = Result.getOrThrow(quantity(buildQuery({ price_list_id: { $in: ["p155"] }, currency_code: "USD", price_set_id: "s155" },
      { relations: ["price_rules"], order: { id: "ASC" } })));
    expect(JSON.stringify(omitted)).not.toContain("min_quantity");
    expect(JSON.stringify(omitted)).not.toContain("max_quantity");
    for (const invalid of [Infinity, "1.25", true]) expect(Result.isFailure(quantity(buildQuery({ price_list_id: { $in: ["p155"] },
      currency_code: "USD", price_set_id: "s155", min_quantity: invalid }, { relations: ["price_rules"], order: { id: "ASC" } })))).toBe(true);
  });
});
