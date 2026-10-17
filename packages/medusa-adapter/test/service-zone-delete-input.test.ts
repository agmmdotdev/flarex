import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileServiceZoneDeletionContracts, decodeServiceZoneDeletionIds, decodeServiceZoneDeletionArguments,
  decodeServiceZoneDeletionOutput } from "../src/modules/fulfillment/service-zone-delete-input";
import { serviceZoneDeletionGraph } from "./support/logical-service-zone-creation-fixture";

let contracts: Result.Result.Success<ReturnType<typeof compileServiceZoneDeletionContracts>>;
const graph = serviceZoneDeletionGraph("zone-delete-input", { geos: 1, options: 1, rules: 1 });
const zone = graph.rows.find(value => value.table === "service_zone")?.row;
const cascades = Object.fromEntries(["ServiceZone", "GeoZone", "ShippingOption", "ShippingOptionRule"].map((model, index) =>
  [model, graph.rows.filter(value => value.table === ["service_zone", "geo_zone", "shipping_option", "shipping_option_rule"][index]).map(value => value.row)]));
beforeAll(async () => { contracts = Result.getOrThrow(compileServiceZoneDeletionContracts((await Effect.runPromise(captureServiceZoneCreationMetadata())).frame)); });

describe("native Service Zone deletion DML boundaries", () => {
  it("retains raw empty, duplicate, missing, whitespace and Unicode IDs under one four-ID bound", () => {
    for (const ids of [[], ["missing", " raw ", "missing", "zone-\u{10000}"]]) {
      expect(Result.getOrThrow(decodeServiceZoneDeletionIds(ids))).toEqual(ids);
      expect(Result.getOrThrow(decodeServiceZoneDeletionArguments([ids]))).toEqual([ids]);
    }
    for (const value of [null, undefined, "scalar", [""], [1], Array(5).fill("id"), ["a".repeat(257)]]) expect(Result.isFailure(decodeServiceZoneDeletionIds(value))).toBe(true);
    for (const args of [[], [[], {}], { ids: [] }]) expect(Result.isFailure(decodeServiceZoneDeletionArguments(args))).toBe(true);
  });

  it("decodes the actual model map with absent empty keys and independent complete cohort bounds", () => {
    for (const value of [{}, { service_zone_id: graph.ids }, { service_zone_id: graph.ids, geo_zone_id: graph.geoIds,
      shipping_option_id: graph.optionIds, shipping_option_rule_id: graph.ruleIds }]) expect(Result.getOrThrow(decodeServiceZoneDeletionOutput(value))).toEqual(value);
    for (const value of [{ service_zone_id: [] }, { geo_zone_id: [] }, { ShippingOption: graph.optionIds }, { extra: [] },
      { geo_zone_id: Array(17).fill("id") }, { shipping_option_id: Array(9).fill("id") }, { shipping_option_rule_id: Array(17).fill("id") },
      { service_zone_id: graph.ids, foreign: true }]) expect(Result.isFailure(decodeServiceZoneDeletionOutput(value))).toBe(true);
  });

  it("validates complete native lifecycle tuple rows before model/linkable projection", () => {
    if (zone === undefined) throw new Error("Missing complete comparison Zone");
    expect(Result.isSuccess(contracts.decodeLifecycleResult([[zone], cascades]))).toBe(true);
    expect(Result.isSuccess(contracts.decodeLifecycleResult([[], {}]))).toBe(true);
    for (const value of [[[zone], {}], [[], cascades], [[zone], { ...cascades, GeoZone: [] }],
      [[zone], { ...cascades, Unknown: [] }], [[zone], { ...cascades, GeoZone: [{ id: "partial" }] }]])
      expect(Result.isFailure(contracts.decodeLifecycleResult(value))).toBe(true);
    expect(contracts.entities.map(entity => [entity.table.name, entity.maximum, entity.linkableKey])).toEqual([
      ["service_zone", 4, "service_zone_id"], ["geo_zone", 16, "geo_zone_id"], ["shipping_option", 8, "shipping_option_id"], ["shipping_option_rule", 16, "shipping_option_rule_id"],
    ]);
  });

  it("refuses cascade metadata drift without broadening the eight-table source", async () => {
    const metadata = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
    for (const tableName of ["service_zone", "shipping_option"])
      expect(Result.isFailure(compileServiceZoneDeletionContracts({ ...metadata, tables: metadata.tables.map(table => table.name === tableName
        ? { ...table, cascades: { ...table.cascades, delete: [] } } : table) }))).toBe(true);
    expect(Result.isFailure(compileServiceZoneDeletionContracts({ ...metadata, tables: metadata.tables.filter(table => table.name !== "shipping_option_rule") }))).toBe(true);
  });
});
