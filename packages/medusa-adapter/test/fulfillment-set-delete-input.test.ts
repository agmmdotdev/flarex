import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentSetDeletionContracts, decodeFulfillmentSetDeletionIds, decodeFulfillmentSetDeletionArguments,
  decodeFulfillmentSetDeletionOutput } from "../src/modules/fulfillment/fulfillment-set-delete-input";
import { decodeFulfillmentSetLifecycleArguments, decodeFulfillmentSetLifecycleIds, decodeFulfillmentSetRepositoryIds } from "../src/modules/fulfillment/fulfillment-set-delete-input";
import { fulfillmentServiceRouting } from "../src/modules/fulfillment/fulfillment-module";
import { fulfillmentSetDeletionGraph } from "./support/logical-fulfillment-set-deletion-fixture";

let contracts: Result.Result.Success<ReturnType<typeof compileFulfillmentSetDeletionContracts>>;
const graph = fulfillmentSetDeletionGraph("set-delete-input", { geos: 1, options: 1, rules: 1 });
const root = graph.rows.find(value => value.table === "fulfillment_set")?.row;
const models = [["FulfillmentSet", "fulfillment_set"], ["ServiceZone", "service_zone"], ["GeoZone", "geo_zone"],
  ["ShippingOption", "shipping_option"], ["ShippingOptionRule", "shipping_option_rule"]] as const;
const cascades = Object.fromEntries(models.map(([model, table]) => [model, graph.rows.filter(value => value.table === table).map(value => value.row)]));
beforeAll(async () => { contracts = Result.getOrThrow(compileFulfillmentSetDeletionContracts((await Effect.runPromise(captureServiceZoneCreationMetadata())).frame)); });

describe("native Fulfillment Set deletion boundaries", () => {
  it("preserves all raw history selector IDs and authenticates the complete native return-key order", () => {
    const ids = ["b", "a", "b", "c", "d", "c", "a", "d"];
    const config = { returnLinkableKeys: Object.keys(fulfillmentServiceRouting().__joinerConfig.linkableKeys ?? {}) };
    expect(config.returnLinkableKeys[0]).toBe("fulfillment_address_id");
    expect(config.returnLinkableKeys).toHaveLength(12);
    expect(Result.getOrThrow(decodeFulfillmentSetLifecycleArguments([{ id: ids }, config]))).toEqual([{ id: ids }, config]);
    expect(Result.getOrThrow(decodeFulfillmentSetLifecycleIds({ selector: { id: ids }, config }))).toEqual(ids);
    expect(Result.getOrThrow(decodeFulfillmentSetRepositoryIds([{ id: ids }]))).toEqual(ids);
    for (const input of [[{ id: [...ids, "b"] }, config], [{ id: ["a", "b", "c", "d", "e"] }, config],
      [{ id: ids }, { returnLinkableKeys: ["fulfillment_set_id"] }], [{ id: ids }, { returnLinkableKeys: [...config.returnLinkableKeys].reverse() }]])
      expect(Result.isFailure(decodeFulfillmentSetLifecycleArguments(input))).toBe(true);
  });
  it("preserves bounded raw IDs, duplicate position, whitespace and Unicode for both retained steps", () => {
    for (const ids of [[], ["missing", " raw ", "missing", "set-\u{10000}"]]) {
      expect(Result.getOrThrow(decodeFulfillmentSetDeletionIds(ids))).toEqual(ids);
      expect(Result.getOrThrow(decodeFulfillmentSetDeletionArguments([ids]))).toEqual([ids]);
    }
    for (const value of [null, undefined, "scalar", [""], [1], Array(5).fill("id"), ["a".repeat(257)]])
      expect(decodeFulfillmentSetDeletionIds(value)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    for (const args of [[], [[], {}], { ids: [] }]) expect(Result.isFailure(decodeFulfillmentSetDeletionArguments(args))).toBe(true);
  });

  it("admits actual affected maps with omitted empty keys under all five independent graph bounds", () => {
    const maximum = { fulfillment_set_id: Array.from({ length: 4 }, (_, index) => "set" + index), service_zone_id: Array.from({ length: 4 }, (_, index) => "zone" + index),
      geo_zone_id: Array.from({ length: 16 }, (_, index) => "geo" + index), shipping_option_id: Array.from({ length: 8 }, (_, index) => "option" + index),
      shipping_option_rule_id: Array.from({ length: 16 }, (_, index) => "rule" + index) };
    for (const value of [{}, { fulfillment_set_id: graph.ids }, maximum]) expect(Result.getOrThrow(decodeFulfillmentSetDeletionOutput(value))).toEqual(value);
    for (const value of [{ fulfillment_set_id: [] }, { service_zone_id: [] }, { geo_zone_id: [] }, { FulfillmentSet: graph.ids }, { extra: [] },
      { fulfillment_set_id: Array(5).fill("id") }, { service_zone_id: Array(5).fill("id") }, { geo_zone_id: Array(17).fill("id") },
      { shipping_option_id: Array(9).fill("id") }, { shipping_option_rule_id: Array(17).fill("id") }, { fulfillment_set_id: graph.ids, foreign: true }])
      expect(decodeFulfillmentSetDeletionOutput(value)).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("checks complete native lifecycle rows before projecting the five-model tuple", () => {
    if (root === undefined) throw new Error("Missing complete Set comparison row");
    expect(Result.isSuccess(contracts.decodeLifecycleResult([[root], cascades]))).toBe(true);
    expect(Result.isSuccess(contracts.decodeLifecycleResult([[], {}]))).toBe(true);
    for (const value of [[[root], {}], [[], cascades], [[root], { ...cascades, ServiceZone: [] }], [[root], { ...cascades, Unknown: [] }],
      [[root], { ...cascades, GeoZone: [{ id: "partial" }] }]]) expect(Result.isFailure(contracts.decodeLifecycleResult(value))).toBe(true);
    expect(contracts.root.name).toBe("fulfillment_set");
    expect(contracts.entities.map(entity => [entity.table.name, entity.maximum, entity.linkableKey])).toEqual([
      ["fulfillment_set", 4, "fulfillment_set_id"], ["service_zone", 4, "service_zone_id"], ["geo_zone", 16, "geo_zone_id"],
      ["shipping_option", 8, "shipping_option_id"], ["shipping_option_rule", 16, "shipping_option_rule_id"],
    ]);
  });

  it("refuses drift in the actual Set-to-Zone and descendant cascade edges of the existing source", async () => {
    const metadata = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
    for (const tableName of ["fulfillment_set", "service_zone", "shipping_option"])
      expect(Result.isFailure(compileFulfillmentSetDeletionContracts({ ...metadata, tables: metadata.tables.map(table => table.name === tableName
        ? { ...table, cascades: { ...table.cascades, delete: [] } } : table) }))).toBe(true);
    expect(Result.isFailure(compileFulfillmentSetDeletionContracts({ ...metadata, tables: metadata.tables.filter(table => table.name !== "shipping_option_rule") }))).toBe(true);
  });
});
