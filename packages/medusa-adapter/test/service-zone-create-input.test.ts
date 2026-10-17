import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureServiceZoneCreationMetadata, compileServiceZoneCreationDefinition,
  compileShippingProfileDefinition, compileShippingProfileDeletionDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileServiceZoneCreationContracts, decodeServiceZoneCreates,
  decodeServiceZonePhysicalDeletionIds } from "../src/modules/fulfillment/service-zone-create-input";

let contracts: Result.Result.Success<ReturnType<typeof compileServiceZoneCreationContracts>>;
const stamp = "2026-10-18T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const zone = { id: "serzo-a", name: " Native Zone ", fulfillment_set_id: "fuset-a", metadata: null, ...managed };
const geo = { id: "fgz-a", type: "country", country_code: "Raw", province_code: null, city: null,
  postal_expression: null, metadata: null, service_zone_id: "serzo-a", ...managed };
beforeAll(async () => { contracts = Result.getOrThrow(compileServiceZoneCreationContracts((await Effect.runPromise(captureServiceZoneCreationMetadata())).frame)); });

describe("metadata-derived native Service Zone creation contracts", () => {
  it("captures bounded raw inputs while leaving native required-property/default precedence to the service", () => {
    for (const input of [[], [{ name: "", fulfillment_set_id: "raw-parent" }], [{ name: " Native Zone ", fulfillment_set_id: "fuset-a", metadata: null,
      geo_zones: [{ country_code: "MM" }, { type: "unknown" }, { type: "city", country_code: "" }, { type: "zip", postal_expression: false }] }]])
      expect(Result.getOrThrow(decodeServiceZoneCreates(input))).toEqual(input);
    expect(Result.getOrThrow(decodeServiceZonePhysicalDeletionIds(["b", "a", "b", "missing"]))).toEqual(["b", "a", "b", "missing"]);
    for (const postal_expression of [{}, [], " Raw ", 123, true, false, null]) {
      const input = [{ name: "Zip", fulfillment_set_id: "parent", geo_zones: [{ type: "zip", postal_expression }] }];
      expect(Result.getOrThrow(decodeServiceZoneCreates(input))).toEqual(input);
    }
  });

  it("refuses managed/supplied identities, foreign relationships and over-budget graphs", () => {
    const base = { name: "Zone", fulfillment_set_id: "parent" }, child = { type: "country", country_code: "MM" };
    for (const field of ["id", "created_at", "updated_at", "deleted_at", "shipping_options", "fulfillment_set", "unknown"])
      expect(Result.isFailure(decodeServiceZoneCreates([{ ...base, [field]: null }]))).toBe(true);
    for (const field of ["id", "created_at", "updated_at", "deleted_at", "service_zone", "service_zone_id", "unknown"])
      expect(Result.isFailure(decodeServiceZoneCreates([{ ...base, geo_zones: [{ ...child, [field]: null }] }]))).toBe(true);
    for (const input of [Array(5).fill(base), [{ ...base, geo_zones: Array(5).fill(child) }], [{ ...base, name: null }],
      [{ ...base, fulfillment_set_id: "" }], [{ ...base, geo_zones: null }], null, base])
      expect(Result.isFailure(decodeServiceZoneCreates(input))).toBe(true);
    for (const ids of [undefined, null, "id", [""], [1], Array(5).fill("id")]) expect(Result.isFailure(decodeServiceZonePhysicalDeletionIds(ids))).toBe(true);
  });

  it("decodes complete DML rows and assembles detached native root/child output without fake parent DTOs", () => {
    expect(Result.getOrThrow(contracts.decodeZoneRow(zone))).toEqual(zone); expect(Result.getOrThrow(contracts.decodeGeoRow(geo))).toEqual(geo);
    const original = structuredClone({ zone, geo }), output = { ...zone, geo_zones: [geo], shipping_options: [] };
    expect(Result.getOrThrow(contracts.initializeRows([zone], [geo]))).toEqual([output]); expect({ zone, geo }).toEqual(original);
    expect(Result.getOrThrow(contracts.initializeRows([zone], []))).toEqual([{ ...zone, geo_zones: [], shipping_options: [] }]);
    expect(Result.getOrThrow(contracts.decodeRows([output]))).toEqual([output]);
    for (const invalid of [[zone], [{ ...output, fulfillment_set: { id: "fuset-a" } }], [{ ...output, geo_zones: [{ ...geo, service_zone_id: "outside" }] }],
      [{ ...output, shipping_options: [{ id: "uncreated-option" }] }], [{ ...output, deleted_at: stamp }], [output, output],
      [{ ...output, geo_zones: [geo, geo] }], [{ ...output, geo_zones: [{ ...geo, service_zone: zone }] }]])
      expect(Result.isFailure(contracts.decodeRows(invalid))).toBe(true);
  });

  it("captures every actual FK cascade and refuses drift in the selected metadata", async () => {
    const frame = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
    expect(contracts.entities.map(entity => [entity.table.name, entity.maximum])).toEqual([
      ["service_zone", 4], ["geo_zone", 16], ["shipping_option", 8], ["shipping_option_rule", 16],
    ]);
    for (const tableName of ["geo_zone", "shipping_option", "shipping_option_rule"])
      expect(Result.isFailure(compileServiceZoneCreationContracts({ ...frame, tables: frame.tables.map(table => table.name === tableName
        ? { ...table, foreignKeys: table.foreignKeys.map(({ onDelete: _onDelete, ...key }) => key) } : table) }))).toBe(true);
    expect(Result.isFailure(compileServiceZoneCreationContracts({ ...frame, tables: frame.tables.filter(table => table.name !== "fulfillment_provider") }))).toBe(true);
  });

  it("keeps existing one/six-table definitions intact while extending the same source lineage only for fresh composition", async () => {
    const one = await Effect.runPromise(compileShippingProfileDefinition()), six = await Effect.runPromise(compileShippingProfileDeletionDefinition()),
      eight = await Effect.runPromise(compileServiceZoneCreationDefinition());
    expect(one.schema.tables).toHaveLength(1); expect(six.schema.tables).toHaveLength(6); expect(eight.schema.tables).toHaveLength(8);
    const { tables: _sixTables, capabilities: sixCapabilities, ...sixIdentity } = six.schema;
    const { tables: eightTables, capabilities: eightCapabilities, ...eightIdentity } = eight.schema;
    expect(eightIdentity).toEqual(sixIdentity);
    for (const table of six.schema.tables) expect(eight.schema.tables.find(value => value.identity.tableId === table.identity.tableId)).toEqual(table);
    const existingCapabilityIds = new Set(sixCapabilities.map(capability => capability.identity.capabilityId));
    expect(eightCapabilities.filter(capability => existingCapabilityIds.has(capability.identity.capabilityId))).toEqual(sixCapabilities);
    expect(eightTables.filter(table => !six.schema.tables.some(prior => prior.identity.tableId === table.identity.tableId)).map(table => table.identity.tableId))
      .toEqual(["geo_zone", "shipping_option_rule"]);
    expect(eightCapabilities.filter(capability => !existingCapabilityIds.has(capability.identity.capabilityId)).map(capability => capability.identity.capabilityId))
      .toEqual(["geo_zone.soft-delete", "geo_zone.timestamps", "shipping_option_rule.soft-delete", "shipping_option_rule.timestamps"]);
    expect(eight.provenance.revision).toBe(six.provenance.revision);
  });
});
