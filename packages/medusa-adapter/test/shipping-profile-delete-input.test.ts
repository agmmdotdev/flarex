import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingProfileDeletionContracts, decodeShippingProfileDeletionIds,
  decodeShippingProfileDeletionArguments, decodeShippingProfileDeletionOutput } from "../src/modules/fulfillment/shipping-profile-delete-input";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingProfileDeletionContracts>>;
const stamp = "2026-10-17T00:00:00.000Z";
const profile = { id: "sp-a", name: "Name", type: "custom", metadata: { retained: true },
  created_at: stamp, updated_at: stamp, deleted_at: null };
const option = { id: "so-a", name: "Shipping", price_type: "flat", data: null, metadata: { retained: true },
  service_zone_id: "zone-a", shipping_profile_id: "sp-a", provider_id: null, shipping_option_type_id: "type-a",
  created_at: stamp, updated_at: stamp, deleted_at: null };

beforeAll(async () => {
  contracts = Result.getOrThrow(compileShippingProfileDeletionContracts((await Effect.runPromise(captureShippingProfileDeletionMetadata())).frame));
});

describe("native ShippingProfile deletion admission", () => {
  it("retains raw duplicate, missing and empty IDs without widening the selector", () => {
    for (const ids of [[], ["sp-a"], ["sp-b", "missing", "sp-a", "sp-b"]]) {
      expect(Result.getOrThrow(decodeShippingProfileDeletionIds(ids))).toEqual(ids);
      expect(Result.getOrThrow(decodeShippingProfileDeletionArguments([ids]))).toEqual([ids]);
    }
    for (const input of ["sp-a", null, {}, [""], [null], Array(5).fill("sp-a"), [{ id: "sp-a" }]])
      expect(Result.isFailure(decodeShippingProfileDeletionIds(input))).toBe(true);
    for (const args of [[], [["sp-a"], {}], [["sp-a"], { relations: [] }]])
      expect(Result.isFailure(decodeShippingProfileDeletionArguments(args))).toBe(true);
  });

  it("selects only root lifecycle and a genuine read-only hasMany Option descriptor", () => {
    expect(contracts.entities.map(entity => [entity.table.name, entity.model, entity.linkableKey, entity.maximum]))
      .toEqual([["shipping_profile", "ShippingProfile", "shipping_profile_id", 4]]);
    expect(contracts.relation).toMatchObject({ name: "shipping_options", targetTable: "shipping_option",
      sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], join: { type: "hasMany", foreignKeys: ["shipping_profile_id"] } });
    expect(contracts.profile.relationships.every(relation => !relation.cascadeDelete)).toBe(true);
    expect(contracts.option.foreignKeys.map(key => key.referencedTable).sort())
      .toEqual(["fulfillment_provider", "service_zone", "shipping_option_type", "shipping_profile"]);
  });

  it("requires every actual DML column on roots and Options before native projection", () => {
    expect(Object.keys(profile).sort()).toEqual(contracts.profile.columns.map(column => column.name).sort());
    expect(Object.keys(option).sort()).toEqual(contracts.option.columns.map(column => column.name).sort());
    expect(Result.getOrThrow(contracts.decodeProfileRow(profile))).toEqual(profile);
    expect(Result.getOrThrow(contracts.decodeOptionRow(option))).toEqual(option);
    expect(Result.getOrThrow(contracts.decodeOptionRow({ ...option, shipping_profile_id: null, provider_id: "provider-a", deleted_at: stamp })))
      .toEqual({ ...option, shipping_profile_id: null, provider_id: "provider-a", deleted_at: stamp });
    for (const field of Object.keys(profile)) {
      const missing: Record<string, unknown> = { ...profile }; delete missing[field];
      expect(Result.isFailure(contracts.decodeProfileRow(missing))).toBe(true);
    }
    for (const field of Object.keys(option)) {
      const missing: Record<string, unknown> = { ...option }; delete missing[field];
      expect(Result.isFailure(contracts.decodeOptionRow(missing))).toBe(true);
    }
    for (const invalid of [{ ...option, id: "" }, { ...option, price_type: "free" }, { ...option, name: null },
      { ...option, service_zone_id: null }, { ...option, shipping_profile_id: 1 }, { ...option, provider_id: {} },
      { ...option, shipping_option_type_id: null }, { ...option, created_at: 1 }, { ...option, updated_at: null },
      { ...option, deleted_at: false }, { ...option, rules: [] }, { ...option, _id: "private" }])
      expect(Result.isFailure(contracts.decodeOptionRow(invalid))).toBe(true);
  });

  it("requires exact native root/map tuple correspondence and disallows sibling results", () => {
    const tuple = [[profile], { ShippingProfile: [profile] }];
    expect(Result.getOrThrow(contracts.decodeLifecycleResult(tuple))).toEqual(tuple);
    expect(Result.getOrThrow(contracts.decodeLifecycleResult([[], {}]))).toEqual([[], {}]);
    for (const invalid of [[], [[profile], {}], [[], { ShippingProfile: [profile] }],
      [[profile], { ShippingProfile: [] }], [[profile], { ShippingProfile: [{ ...profile, name: "forged" }] }],
      [[profile], { ShippingProfile: [profile], ShippingOption: [option] }],
      [[{ ...profile, unknown_field: true }], { ShippingProfile: [{ ...profile, unknown_field: true }] }]])
      expect(Result.isFailure(contracts.decodeLifecycleResult(invalid))).toBe(true);
    for (const valid of [{}, { shipping_profile_id: ["sp-a"] }])
      expect(Result.getOrThrow(decodeShippingProfileDeletionOutput(valid))).toEqual(valid);
    for (const invalid of [undefined, [], null, { shipping_profile_id: [1] }, { shipping_profile_id: Array(5).fill("sp-a") },
      { shipping_profile_id: ["sp-a"], shipping_option_id: ["so-a"] }])
      expect(Result.isFailure(decodeShippingProfileDeletionOutput(invalid))).toBe(true);
  });
});
