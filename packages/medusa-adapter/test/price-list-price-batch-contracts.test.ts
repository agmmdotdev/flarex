import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceDecoder } from "../src/value/decoder";
import { PriceListPriceBatchWorkflowInput, compilePriceListPriceBatchContracts } from "../src/modules/pricing/price-list-price-batch-input";
import { PriceListPriceUpdateWorkflowInput } from "../src/modules/pricing/price-list-price-update-input";
import { capturePricingMetadata } from "../src/modules/pricing/schema";

const decode = commerceDecoder(PriceListPriceBatchWorkflowInput, "invalidInput");
const price = { variant_id: "v158", currency_code: "USD", amount: -1.25 };
const empty = { id: "plist158", create: [], update: [], delete: [] };

describe("native Price List Price batch contracts", () => {
  it("preserves native raw fields, empty branches and omitted quantity distinctions", () => {
    for (const data of [empty, { ...empty, id: "", create: [price, { ...price, min_quantity: null, rules: {} }],
      update: [{ id: "", variant_id: "", amount: 0 }], delete: ["", "p158", "p158"] }])
      expect(Result.getOrThrow(decode({ data }))).toEqual({ data });
    const parsed = Result.getOrThrow(decode({ data: { ...empty, create: [price] } }));
    expect(Object.hasOwn(parsed.data.create[0]!, "min_quantity")).toBe(false);
  });
  it("requires the native parent's arrays and update IDs without inheriting the child extension", () => {
    const update = { variant_id: "v158", amount: 40 };
    expect(Result.isSuccess(commerceDecoder(PriceListPriceUpdateWorkflowInput, "invalidInput")({ data: [{ id: "plist158", prices: [update] }] }))).toBe(true);
    for (const data of [{ id: "plist158" }, { id: "plist158", create: [], update: [] },
      { ...empty, update: [update] }, { ...empty, update: [{ ...update, id: 1 }] }])
      expect(Result.isFailure(decode({ data }))).toBe(true);
  });
  it("closes the one-List graph without granting managed fields or widening child bounds", () => {
    for (const data of [{ ...empty, create: [price, price, price] },
      { ...empty, update: Array.from({ length: 3 }, () => ({ ...price, id: "p158" })) },
      { ...empty, delete: Array.from({ length: 9 }, () => "p158") },
      { ...empty, id: "p".repeat(257) }, { ...empty, create: [{ ...price, id: "caller158" }] },
      { ...empty, create: [{ ...price, rules: { a: "1", b: "2", c: "3" } }] },
      { ...empty, update: [{ ...price, id: "p158", created_at: "caller" }] },
      { ...empty, price_set_id: "caller" }]) expect(Result.isFailure(decode({ data }))).toBe(true);
    expect(Result.isFailure(decode({ data: empty, compensation: {} }))).toBe(true);
  });
  it("retains each complete child output contract in its named slot", async () => {
    const contracts = Result.getOrThrow(compilePriceListPriceBatchContracts((await Effect.runPromise(capturePricingMetadata())).frame));
    const output = commerceDecoder(contracts.Output, "storedCorruption");
    const row = { id: "price158", currency_code: "USD", amount: 1.25,
      raw_amount: { value: "1.25", precision: 20 }, price_set_id: "pset158", price_list_id: "plist158" };
    const valid = { created: [row], updated: [row, row], deleted: ["price158"] };
    expect(Result.getOrThrow(output(valid))).toEqual(valid);
    for (const invalid of [{ ...valid, updated: undefined }, { ...valid, created: [row, row, row] },
      { ...valid, updated: [{ ...row, raw_amount: { value: 1.25, precision: 20 } }] },
      { ...valid, created: [{ ...row, undeclared: true }] }, { ...valid, deleted: Array.from({ length: 9 }, () => "p158") }])
      expect(Result.isFailure(output(invalid))).toBe(true);
  });
});
