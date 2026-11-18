import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceDecoder } from "../src/value/decoder";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compilePriceListPriceRemovalContracts, PriceListPriceRemovalWorkflowInput,
  decodePriceListPriceRemovalRead } from "../src/modules/pricing/price-list-price-removal-input";

const decode = commerceDecoder(PriceListPriceRemovalWorkflowInput, "invalidInput");
const stamp = "2026-10-20T00:00:00.000Z";
const list = { id: "plist157", title: "List", description: "List description", status: "draft", type: "sale", starts_at: null,
  ends_at: null, rules_count: 0, created_at: stamp, updated_at: stamp, deleted_at: null };
const price = { id: "price157", title: null, currency_code: "usd", amount: 40, raw_amount: { value: "40", precision: 20 },
  min_quantity: null, raw_min_quantity: null, max_quantity: null, raw_max_quantity: null, rules_count: 2,
  price_set_id: "pset157", price_list_id: "plist157", created_at: stamp, updated_at: stamp, deleted_at: null };
const dto = { ...price, price_set: { id: "pset157" }, price_list: list };
const contracts = async () => Result.getOrThrow(compilePriceListPriceRemovalContracts((await Effect.runPromise(capturePricingMetadata())).frame));

describe("Price List Price removal read contracts", () => {
  it("retains raw empty strings, duplicate selectors and empty roots within the eight-member input bound", () => {
    for (const ids of [[], ["", "price157", "price157"], Array.from({ length: 8 }, () => "x".repeat(256))])
      expect(Result.getOrThrow(decode({ ids }))).toEqual({ ids });
    for (const value of [{ ids: Array.from({ length: 9 }, () => "price157") }, { ids: ["x".repeat(257)] },
      { ids: [1] }, { ids: ["price157"], withDeleted: true }, { price_list_ids: ["plist157"] }])
      expect(Result.isFailure(decode(value))).toBe(true);
  });
  it("admits the exact original public listPrices branch without expanding Lists or granting arbitrary relations", () => {
    expect(Result.getOrThrow(decodePriceListPriceRemovalRead({ filters: { id: ["", "price157", "price157"] },
      config: { relations: ["price_list"] } }))).toEqual({ filters: { id: ["", "price157", "price157"] }, config: { relations: ["price_list"] } });
    for (const value of [{ filters: { id: ["price157"] }, config: {} },
      { filters: { price_list_id: ["plist157"] }, config: { relations: ["price_list"] } },
      { filters: { id: ["price157"] }, config: { relations: ["price_rules"] } },
      { filters: { id: ["price157"] }, config: { relations: ["price_list"], withDeleted: true } }])
      expect(Result.isFailure(decodePriceListPriceRemovalRead(value))).toBe(true);
  });
  it("translates the native DAL envelope with explicit active Price ID ordering and a separate required-Set predicate", async () => {
    const contract = await contracts();
    const native = buildQuery({ id: ["price-z", "price-a", "price-z", ""] }, { relations: ["price_list"], order: { id: "ASC" } });
    const plan = Result.getOrThrow(contract.compileNativeReadPlan(native));
    expect(plan.rootQuery()).toMatchObject({ order: { column: "id", direction: "asc" }, includeIdentities: true,
      predicate: { kind: "and", children: [{ kind: "and", children: [{ kind: "in", column: "id", values: ["price-z", "price-a", ""] }] },
        { kind: "isNull", column: "deleted_at" }] } });
    const membership = { kind: "in", column: "price_set_id", values: ["pset157"] };
    expect(plan.rootQuery(membership).predicate).toMatchObject({ children: [expect.anything(), membership] });
    expect(plan.setPredicate(["pset157"])).toEqual({ kind: "and", children: [
      { kind: "in", column: "id", values: ["pset157"] }, { kind: "isNull", column: "deleted_at" }] });
  });
  it("refuses DAL widening and captures descriptors without invoking getters", async () => {
    const contract = await contracts();
    const valid = buildQuery({ id: ["price157"] }, { relations: ["price_list"], order: { id: "ASC" } });
    for (const input of [{ ...valid, where: { price_list_id: ["plist157"] } },
      { ...valid, options: { ...valid.options, orderBy: { id: "DESC" } } },
      { ...valid, options: { ...valid.options, limit: 1 } },
      { ...valid, options: { ...valid.options, filters: { softDeletable: { withDeleted: true } } } },
      { ...valid, options: { ...valid.options, populate: ["price_list", "price_rules"] } }])
      expect(Result.isFailure(contract.compileNativeReadPlan(input))).toBe(true);
    let reads = 0;
    const getter = Object.defineProperty({}, "where", { enumerable: true, get: () => { reads++; return valid.where; } });
    expect(Result.isFailure(contract.compileNativeReadPlan(getter))).toBe(true);
    expect(reads).toBe(0);
  });
  it("validates complete Price/List DML and native reference identities before accepting the returned DTO", async () => {
    const contract = await contracts();
    expect(Result.getOrThrow(contract.decodeReadOutput([dto]))).toEqual([dto]);
    expect(Result.getOrThrow(contract.decodeReadOutput([{ ...dto, price_list_id: null, price_list: null }]))).toEqual([
      { ...dto, price_list_id: null, price_list: null }]);
    const { title: _title, ...incompleteList } = list;
    const { raw_amount: _raw, ...incompletePrice } = dto;
    for (const invalid of [{ ...dto, price_set: { id: "wrong" } }, { ...dto, price_list: { ...list, id: "wrong" } },
      { ...dto, price_list: incompleteList }, incompletePrice, { ...dto, price_list: null },
      { ...dto, price_list: { ...list, description: null } },
      { ...dto, price_list: { ...list, deleted_at: stamp } }, { ...dto, deleted_at: stamp },
      { ...dto, undeclared: true }, { ...dto, price_list: { ...list, undeclared: true } }])
      expect(contract.decodeReadOutput([invalid])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });
});
