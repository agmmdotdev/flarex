import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { getSelectsAndRelationsFromObjectArray } from "@medusajs/utils/common/get-selects-and-relations-from-object-array";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { relationScalarFieldPaths, type ScalarFieldRelationDescriptor } from "@medusajs/drizzle/relation-query";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileServiceZoneUpdateContracts, decodeServiceZoneUpdateInput, decodeServiceZoneUpdateUpserts } from "../src/modules/fulfillment/service-zone-update-input";
import { prepareServiceZoneUpdateQuery } from "../src/modules/fulfillment/service-zone-update-query";
import { projectRows } from "../src/query/projection";
import { captureCommerceInput } from "../src/value/input";

let contracts: Result.Result.Success<ReturnType<typeof compileServiceZoneUpdateContracts>>;
let query: Result.Result.Success<ReturnType<typeof prepareServiceZoneUpdateQuery>>;
let frame: Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];
const stamp = "2026-10-18T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const zone = { id: "serzo-a", name: " Native Zone ", fulfillment_set_id: "fuset-a", metadata: null, ...managed };
const geo = { id: "fgz-a", type: "country", country_code: "Raw", province_code: null, city: null,
  postal_expression: null, metadata: null, service_zone_id: zone.id, ...managed };
const newGeos = [{ type: "country", country_code: "MM" }, { type: "province", country_code: "US", province_code: "CA" },
  { type: "city", country_code: "TH", province_code: "BK", city: "Bangkok" },
  { type: "zip", country_code: "GB", province_code: "LND", city: "London", postal_expression: { eq: "SW1" } }];
beforeAll(async () => {
  frame = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
  contracts = Result.getOrThrow(compileServiceZoneUpdateContracts(frame));
  query = Result.getOrThrow(prepareServiceZoneUpdateQuery(contracts));
});

describe("native ServiceZone update input and retained-original admission", () => {
  it("retains raw selector order, duplicates, empty patches and native strings", () => {
    for (const input of [{ selector: { id: [] }, update: {} },
      { selector: { id: ["z", "a", "z", "missing"] }, update: { name: " Raw " } },
      { selector: { id: zone.id }, update: { name: "", geo_zones: [] } },
      { selector: { id: zone.id }, update: { geo_zones: newGeos } }])
      expect(Result.getOrThrow(decodeServiceZoneUpdateInput(input))).toEqual(input);
    expect(Result.getOrThrow(decodeServiceZoneUpdateInput({ selector: { id: zone.id }, update: { name: undefined, geo_zones: undefined } })))
      .toEqual({ selector: { id: zone.id }, update: {} });
    expect(buildQuery({ id: ["A", "B", "A"] }).where).toEqual({ id: ["A", "B"] });
  });

  it("keeps nullable name shape separate from the required native stored column", () => {
    const input = { selector: { id: zone.id }, update: { name: null } };
    expect(Result.getOrThrow(decodeServiceZoneUpdateInput(input))).toEqual(input);
    expect(Result.isFailure(contracts.decodeZoneRow({ ...zone, name: null }))).toBe(true);
    for (const child of [{}, { type: "unknown" }, { type: "country", country_code: "" }, { type: "zip", postal_expression: false }])
      expect(Result.getOrThrow(decodeServiceZoneUpdateInput({ selector: { id: zone.id }, update: { geo_zones: [child] } })))
        .toEqual({ selector: { id: zone.id }, update: { geo_zones: [child] } });
  });

  it("admits new geography or ID-only existing members without widening their union", () => {
    const input = { selector: { id: zone.id }, update: { geo_zones: [{ id: geo.id }, newGeos[0]] } };
    expect(Result.getOrThrow(decodeServiceZoneUpdateInput(input))).toEqual(input);
    for (const child of [{ id: "" }, { id: "x".repeat(257) }, { id: geo.id, type: "zip" }, { id: geo.id, country_code: "TH" },
      { id: geo.id, postal_expression: {} }, { id: geo.id, metadata: null }, { id: geo.id, updated_at: stamp }])
      expect(Result.isFailure(decodeServiceZoneUpdateInput({ selector: { id: zone.id }, update: { geo_zones: [child] } }))).toBe(true);
    for (const postal_expression of [{ eq: "SW1", opaque: { values: [1, false] } }, ["SW1", { eq: "SW2" }], " Raw ", 12, true, false, null]) {
      const input = { selector: { id: zone.id }, update: { geo_zones: [{ type: "zip", postal_expression }] } };
      expect(Result.getOrThrow(decodeServiceZoneUpdateInput(input))).toEqual(input);
    }
  });

  it("refuses managed/root identities, undeclared writes and broad selectors", () => {
    for (const field of ["id", "metadata", "created_at", "updated_at", "deleted_at", "fulfillment_set_id", "fulfillment_set", "shipping_options", "unknown"])
      expect(Result.isFailure(decodeServiceZoneUpdateInput({ selector: { id: zone.id }, update: { [field]: null } }))).toBe(true);
    for (const field of ["id", "created_at", "updated_at", "deleted_at", "service_zone_id", "service_zone", "unknown"])
      expect(Result.isFailure(decodeServiceZoneUpdateInput({ selector: { id: zone.id }, update: { geo_zones: [{ type: "country", [field]: null }] } }))).toBe(true);
    for (const input of [null, [], { selector: {}, update: {} }, { selector: { name: "Zone" }, update: {} },
      { selector: { id: "" }, update: {} }, { selector: { id: zone.id, unknown: true }, update: {} },
      { selector: { id: zone.id }, update: { geo_zones: null } }, { selector: { id: zone.id }, update: {}, unknown: true }])
      expect(Result.isFailure(decodeServiceZoneUpdateInput(input))).toBe(true);
  });

  it("bounds raw selectors and forward geography independently from retained old rows", () => {
    const input = { selector: { id: ["a", "b", "c", "d"] }, update: { geo_zones: newGeos } };
    expect(Result.getOrThrow(decodeServiceZoneUpdateInput(input))).toEqual(input);
    for (const input of [{ selector: { id: Array(5).fill("a") }, update: {} },
      { selector: { id: zone.id }, update: { geo_zones: Array(5).fill({ type: "country" }) } }])
      expect(Result.isFailure(decodeServiceZoneUpdateInput(input))).toBe(true);
    const retained = [{ id: zone.id, geo_zones: Array.from({ length: 16 }, (_, index) => ({ id: "old-" + index, service_zone_id: zone.id })) }];
    expect(Result.getOrThrow(decodeServiceZoneUpdateUpserts(retained))).toEqual(retained);
    for (const input of [[{}], [{ name: "ID-less create is not a retained original" }], [{ id: zone.id, created_at: stamp }],
      [{ id: zone.id, geo_zones: Array.from({ length: 17 }, (_, index) => ({ id: "old-" + index })) }], Array(5).fill({ id: zone.id })])
      expect(Result.isFailure(decodeServiceZoneUpdateUpserts(input))).toBe(true);
  });
});

describe("metadata-derived native update outputs and projected originals", () => {
  it("accepts scalar results without creation-only relations and separately accepts real preimages", () => {
    for (const output of [[zone], [{ ...zone, geo_zones: [] }], [{ ...zone, geo_zones: [geo] }]])
      expect(Result.getOrThrow(contracts.decodeRows(output))).toEqual(output);
    for (const original of [[{ id: zone.id }], [{ id: zone.id, name: zone.name }],
      [{ id: zone.id, geo_zones: [{ id: geo.id, service_zone_id: zone.id }] }]])
      expect(Result.getOrThrow(contracts.decodePreimages(original))).toEqual(original);
    expect(Object.hasOwn(Result.getOrThrow(contracts.decodeRows([zone]))[0] ?? {}, "geo_zones")).toBe(false);
    for (const invalid of [[{ id: zone.id }], [{ ...zone, geo_zones: [{ id: geo.id, service_zone_id: zone.id }] }],
      [{ ...zone, shipping_options: [] }], [{ ...zone, fulfillment_set: { id: "fuset-a" } }]])
      expect(Result.isFailure(contracts.decodeRows(invalid))).toBe(true);
    for (const field of Object.keys(zone)) {
      const missing: Record<string, unknown> = { ...zone }; delete missing[field];
      expect(Result.isFailure(contracts.decodeRows([missing]))).toBe(true);
    }
    for (const field of Object.keys(geo)) {
      const missing: Record<string, unknown> = { ...geo }; delete missing[field];
      expect(Result.isFailure(contracts.decodeRows([{ ...zone, geo_zones: [missing] }]))).toBe(true);
    }
  });

  it("rejects duplicate identities, foreign ownership, tombstones and unknown projected fields", () => {
    for (const decode of [contracts.decodeRows, contracts.decodePreimages]) {
      for (const invalid of [[zone, zone], [{ ...zone, geo_zones: [geo, geo] }],
        [{ ...zone, geo_zones: [{ ...geo, service_zone_id: "outside" }] }],
        [{ ...zone, deleted_at: stamp }], [{ ...zone, geo_zones: [{ ...geo, deleted_at: stamp }] }],
        [{ ...zone, unknown: true }], [{ ...zone, geo_zones: [{ ...geo, service_zone: zone }] }]])
        expect(Result.isFailure(decode(invalid))).toBe(true);
    }
    for (const invalid of [[{}], [{ id: zone.id, name: null }], [{ id: zone.id, geo_zones: [{ id: geo.id }] }],
      [{ id: zone.id, geo_zones: [{ id: geo.id, service_zone_id: zone.id, country_code: 1 }] }]])
      expect(Result.isFailure(contracts.decodePreimages(invalid))).toBe(true);
  });

  it("proves the complete four-root sixteen-child cohort rather than a per-row-only limit", () => {
    const output = Array.from({ length: 4 }, (_, root) => ({ ...zone, id: "zone-" + root,
      geo_zones: Array.from({ length: 4 }, (_, child) => ({ ...geo, id: "geo-" + root + "-" + child, service_zone_id: "zone-" + root })) }));
    expect(Result.getOrThrow(contracts.decodeRows(output))).toEqual(output);
    expect(Result.isFailure(contracts.decodeRows([...output, { ...zone, id: "fifth", geo_zones: [] }]))).toBe(true);
    const overflow = output.map((row, index) => index ? row : { ...row,
      geo_zones: [...row.geo_zones, { ...geo, id: "seventeenth", service_zone_id: row.id }] });
    expect(Result.isFailure(contracts.decodeRows(overflow))).toBe(true);
    expect(Result.isFailure(contracts.decodePreimages(overflow))).toBe(true);
  });

  it("refuses structural drift in the shared eight-table ownership proof", () => {
    expect(Result.isFailure(compileServiceZoneUpdateContracts({ ...frame, tables: frame.tables.filter(table => table.name !== "fulfillment_provider") }))).toBe(true);
    for (const tableName of ["geo_zone", "shipping_option", "shipping_option_rule"])
      expect(Result.isFailure(compileServiceZoneUpdateContracts({ ...frame, tables: frame.tables.map(table => table.name === tableName
        ? { ...table, foreignKeys: table.foreignKeys.map(({ onDelete: _onDelete, ...key }) => key) } : table) }))).toBe(true);
    expect(Result.isFailure(compileServiceZoneUpdateContracts({ ...frame, tables: frame.tables.map(table => table.name === "geo_zone"
      ? { ...table, relationships: [], foreignKeys: [] } : table) }))).toBe(true);
  });
});

describe("authentic native metadata-only relation scalar paths", () => {
  const leaf: ScalarFieldRelationDescriptor = { targetModel: { parse: () => ({ schema: { id: null, code: null } }) }, relationship: { targetModel: "Leaf" } };
  const geography: ScalarFieldRelationDescriptor = { targetModel: { parse: () => ({ schema: { id: null, postal_expression: null, metadata: null, amount: null } }) },
    relationship: { targetModel: "Geography" } };
  const descriptors = new Map([["geo_zones", geography]]);
  const byModel = new Map<string, ReadonlyMap<string, ScalarFieldRelationDescriptor>>([
    ["Geography", new Map([["leaf", leaf]])], ["Leaf", new Map()],
  ]);
  it("finds the real scalar JSON boundary while preserving raw aliases and virtual terminal fields", () => {
    expect(relationScalarFieldPaths(["geo_zones.postal_expression.eq", "geo_zones.metadata.opaque"], descriptors, byModel))
      .toEqual(["geo_zones.postal_expression", "geo_zones.metadata"]);
    expect(relationScalarFieldPaths(["geo_zones.raw_amount", "geo_zones.raw_amount.virtual.amount"], descriptors, byModel))
      .toEqual(["geo_zones.raw_amount", "geo_zones.amount", "geo_zones.raw_amount", "geo_zones.amount", "geo_zones.amount"]);
    expect(relationScalarFieldPaths(["geo_zones.leaf.virtual.code"], descriptors, byModel))
      .toEqual(["geo_zones.leaf.virtual", "geo_zones.leaf.code"]);
  });
  it("does not invent traversal through false relation prefixes or deduplicate native output", () => {
    for (const populate of [undefined, false, true, [], ["unknown.postal_expression", "postal_expression.eq", "geo_zones"]])
      expect(relationScalarFieldPaths(populate, descriptors, byModel)).toEqual([]);
    expect(relationScalarFieldPaths(["geo_zones.postal_expression.eq", "geo_zones.postal_expression.eq"], descriptors, byModel))
      .toEqual(["geo_zones.postal_expression", "geo_zones.postal_expression"]);
  });
});

describe("named native ServiceZone preimage query projection", () => {
  it("preserves complete opaque postal JSON instead of treating eq as a relationship", () => {
    const selection = getSelectsAndRelationsFromObjectArray([{ geo_zones: [{ id: geo.id }, newGeos[3]] }]);
    const plan = Result.getOrThrow(query.query(Result.getOrThrow(captureCommerceInput(buildQuery({ id: zone.id }, { select: selection.selects, relations: selection.relations })))));
    const values: Json[] = [{ eq: "SW1", in: ["SW1", "SW2"], opaque: { nested: true } }, ["SW1", { eq: "SW2" }, 7], "SW1", 12, true, null];
    for (const postal_expression of values) {
      const child = { ...geo, type: "zip", postal_expression };
      const projected = Result.getOrThrow(projectRows([{ ...zone, geo_zones: [child] }], plan.fields.node));
      expect(projected).toEqual([{ id: zone.id, geo_zones: [{ id: geo.id, type: "zip", country_code: geo.country_code,
        province_code: null, city: null, postal_expression, service_zone_id: zone.id }] }]);
      expect(Result.getOrThrow(contracts.decodePreimages(projected))).toEqual(projected);
    }
  });
  it("distinguishes scalar, ID-only child and empty-replacement complete-child preimages", () => {
    for (const [update, expected] of [[{}, [{ id: zone.id }]], [{ name: "New" }, [{ id: zone.id, name: zone.name }]],
      [{ geo_zones: [{ id: geo.id }] }, [{ id: zone.id, geo_zones: [{ id: geo.id, service_zone_id: zone.id }] }]],
      [{ geo_zones: [] }, [{ id: zone.id, geo_zones: [geo] }]]] as const) {
      const selection = getSelectsAndRelationsFromObjectArray([update]);
      const plan = Result.getOrThrow(query.query(Result.getOrThrow(captureCommerceInput(buildQuery({ id: zone.id }, { select: selection.selects, relations: selection.relations })))));
      expect(Result.getOrThrow(projectRows([{ ...zone, geo_zones: [geo] }], plan.fields.node))).toEqual(expected);
    }
  });
  it("refuses undeclared relationship/lifecycle/order capabilities and oversized roots", () => {
    for (const options of [{ populate: ["fulfillment_set"] }, { populate: ["shipping_options"] }, { populate: ["geo_zones.service_zone"] },
      { limit: 5 }, { offset: 1 }, { orderBy: { id: "DESC" } }, { filters: { softDeletable: { withDeleted: true } } }])
      expect(Result.isFailure(query.query({ where: { id: zone.id }, options }))).toBe(true);
    expect(Result.isFailure(query.query({ where: { name: "Zone" }, options: {} }))).toBe(true);
    expect(Result.isFailure(query.query({ where: { id: Array(5).fill(zone.id) }, options: {} }))).toBe(true);
  });
});
