import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareServiceZoneUpdateRepository } from "../src/modules/fulfillment/service-zone-update-repository";
import { serviceZoneUpdatePolicy } from "../src/modules/fulfillment/service-zone-update-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof serviceZoneUpdatePolicy>;
const stamp = "2026-10-18T00:00:00.000Z";
const zone = (id: string): JsonObject => ({ id, name: id, fulfillment_set_id: "parent", metadata: null, created_at: stamp, updated_at: stamp, deleted_at: null });
const geo: JsonObject = { id: "geo-a", type: "zip", country_code: "GB", province_code: "LND", city: "London",
  postal_expression: { eq: "SW1", in: ["SW1", "SW2"], opaque: { nested: true } }, metadata: null, service_zone_id: "zone-a", created_at: stamp, updated_at: stamp, deleted_at: null };
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const rootRead = (ids: readonly string[], count: number): Activity["relationalReads"][number] => ({ table: "service_zone",
  query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
    { kind: "and", children: [{ kind: "in", column: "id", values: ids }] }, { kind: "isNull", column: "deleted_at" },
  ] }), total: count, returned: count });
const geoRead = (ids: readonly string[], count: number): Activity["relationalReads"][number] => ({ table: "geo_zone",
  query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
    { kind: "in", column: "service_zone_id", values: ids }, { kind: "isNull", column: "deleted_at" },
  ] }, { kind: "storageInsertion", direction: "asc" }), total: count, returned: count,
  orderedIdentities: count === 0 ? [] : [{ id: "geo-a" }] });
const call = (commandName: string, input: Json, result: Json): Call => ({ commandName, mode: commandName === "serviceZoneListForUpdate" ? "read" : "write",
  input, result, events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const refused = async (receipt: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = serviceZoneUpdatePolicy(Result.getOrThrow(prepareServiceZoneUpdateRepository(
  (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame))); });

describe("native Service Zone update receipt correlation", () => {
  // Fixed transcripts pin adversarial read/projection correlation. Complete
  // genuine roots in both DB lanes separately prove all replacement writes.
  it("requires a real nonempty selector lookup even when the claimed result is empty", async () => {
    for (const receipt of [call("serviceZoneListForUpdate", { filters: { id: "zone-a" }, config: { select: ["name"], relations: [] } }, []),
      call("serviceZoneUpdateForWorkflow", { selector: { id: "zone-a" }, update: { name: "changed" } }, [])]) await refused(receipt, empty());
  });

  it("correlates actual first-occurrence selector order and exact scalar projected preimages", async () => {
    const a = zone("zone-a"), b = zone("zone-b"), receipt = call("serviceZoneListForUpdate", {
      filters: { id: ["zone-b", "zone-a", "zone-b"] }, config: { select: ["name"], relations: [] },
    }, [{ id: "zone-b", name: "zone-b" }, { id: "zone-a", name: "zone-a" }]);
    const activity: Activity = { ...empty(), observedRows: [a, b].map(row => ({ table: "service_zone", row })), relationalReads: [rootRead(["zone-b", "zone-a"], 2)] };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused({ ...receipt, result: [{ id: "zone-a", name: "zone-a" }, { id: "zone-b", name: "zone-b" }] }, activity);
    await refused({ ...receipt, result: [b, a] }, activity);
    await refused({ ...receipt, result: [{ id: "zone-b", name: "forged" }, { id: "zone-a", name: "zone-a" }] }, activity);
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "service_zone", row: zone("outside") }] });
    await Effect.runPromise(policy.validateLogicalCall(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "service_zone", row: a }] }));
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "service_zone", row: { ...a, name: "conflicting duplicate" } }] });
  });

  it("authenticates zero-result original cohorts and retains native early return before graph reads", async () => {
    for (const ids of [[], ["missing"]]) {
      const receipt = call("serviceZoneUpdateForWorkflow", { selector: { id: ids }, update: { geo_zones: [{ type: "country", country_code: "MM" }] } }, []);
      const activity = { ...empty(), relationalReads: [rootRead(ids, 0)] }; await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
      await refused(receipt, empty()); await refused(receipt, { ...activity, relationalReads: [...activity.relationalReads, geoRead(ids, 0)] });
      await refused({ ...receipt, result: [zone("outside")] }, activity);
      await refused(receipt, { ...activity, observedRows: [{ table: "service_zone", row: zone("outside") }] });
    }
    await Effect.runPromise(policy.validateLogicalCall(call("serviceZoneUpsertForUpdateInverse", [], []), empty()));
  });

  it("accepts an exactly requested historical root candidate excluded from active results and refuses unrelated history", async () => {
    const id = "historical-requested", historical = { ...zone(id), deleted_at: stamp };
    const activity: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: historical }], relationalReads: [rootRead([id], 0)] };
    for (const receipt of [call("serviceZoneListForUpdate", { filters: { id }, config: { select: ["name"], relations: [] } }, []),
      call("serviceZoneUpdateForWorkflow", { selector: { id }, update: { name: "unused" } }, [])]) {
      await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
      await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "service_zone", row: { ...zone("unrelated-history"), deleted_at: stamp } }] });
      await refused(receipt, { ...activity, relationalReads: [rootRead([id], 1)] });
      await refused(receipt, { ...activity, observedRows: [...activity.observedRows,
        { table: "geo_zone", row: { ...geo, id: "unqueried-history", service_zone_id: id, deleted_at: stamp } }] });
    }
  });

  it("accepts historical Geo candidates only under the actually populated active-parent FK", async () => {
    const historical = { ...geo, id: "historical-geo", deleted_at: stamp };
    const receipt = call("serviceZoneListForUpdate", { filters: { id: "zone-a" }, config: { select: ["geo_zones.id"], relations: ["geo_zones"] } },
      [{ id: "zone-a", geo_zones: [{ id: "geo-a", service_zone_id: "zone-a" }] }]);
    const activity: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: zone("zone-a") }, { table: "geo_zone", row: geo },
      { table: "geo_zone", row: historical }], relationalReads: [rootRead(["zone-a"], 1), geoRead(["zone-a"], 1)] };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused(receipt, { ...activity, relationalReads: [rootRead(["zone-a"], 1), { ...geoRead(["zone-a"], 1), orderedIdentities: [{ id: "historical-geo" }] }] });
    await refused(receipt, { ...activity, relationalReads: [rootRead(["zone-a"], 1), { ...geoRead(["zone-a"], 2), orderedIdentities: [{ id: "geo-a" }, { id: "historical-geo" }] }] });
    await refused({ ...receipt, result: [{ id: "zone-a", geo_zones: [{ id: "geo-a", service_zone_id: "zone-a" },
      { id: "historical-geo", service_zone_id: "zone-a" }] }] }, activity);
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows,
      { table: "geo_zone", row: { ...historical, id: "outside-history", service_zone_id: "outside-parent" } }] });
    const deletedParent = { ...zone("requested-deleted-parent"), deleted_at: stamp };
    await refused({ ...receipt, input: { filters: { id: ["zone-a", "requested-deleted-parent"] },
      config: { select: ["geo_zones.id"], relations: ["geo_zones"] } } }, { ...activity,
      observedRows: [...activity.observedRows, { table: "service_zone", row: deletedParent },
        { table: "geo_zone", row: { ...historical, id: "unpopulated-parent-history", service_zone_id: "requested-deleted-parent" } }],
      relationalReads: [rootRead(["zone-a", "requested-deleted-parent"], 1), geoRead(["zone-a"], 1)] });
  });

  it("rejects wrong, missing, partial, extra and foreign-table selector evidence", async () => {
    const receipt = call("serviceZoneListForUpdate", { filters: { id: "zone-a" }, config: { select: ["name"], relations: [] } }, [{ id: "zone-a", name: "zone-a" }]);
    const activity: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: zone("zone-a") }], relationalReads: [rootRead(["zone-a"], 1)] };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    for (const relationalReads of [[], [rootRead(["outside"], 1)], [rootRead(["zone-a"], 0)], [{ ...rootRead(["zone-a"], 1), returned: 0 }],
      [rootRead(["zone-a"], 1), rootRead(["zone-a"], 1)], [{ ...rootRead(["zone-a"], 1), table: "fulfillment_set" }]]) await refused(receipt, { ...activity, relationalReads });
    await refused(receipt, { ...activity, relationalReads: [{ ...rootRead(["zone-a"], 1), orderedIdentities: [{ id: "zone-a" }] }] });
  });

  it("binds Geo presentation to the authentic ordered identities rather than lexical IDs", async () => {
    const z = { ...geo, id: "geo-z" }, a = { ...geo, id: "geo-a" };
    const receipt = call("serviceZoneListForUpdate", { filters: { id: "zone-a" }, config: { select: ["geo_zones.id"], relations: ["geo_zones"] } },
      [{ id: "zone-a", geo_zones: [{ id: "geo-z", service_zone_id: "zone-a" }, { id: "geo-a", service_zone_id: "zone-a" }] }]);
    const ordered = { ...geoRead(["zone-a"], 2), orderedIdentities: [{ id: "geo-z" }, { id: "geo-a" }] };
    const activity: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: zone("zone-a") },
      { table: "geo_zone", row: a }, { table: "geo_zone", row: z }], relationalReads: [rootRead(["zone-a"], 1), ordered] };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused(receipt, { ...activity, relationalReads: [rootRead(["zone-a"], 1), { ...ordered, orderedIdentities: [{ id: "geo-a" }, { id: "geo-z" }] }] });
    await refused({ ...receipt, result: [{ id: "zone-a", geo_zones: [{ id: "geo-a", service_zone_id: "zone-a" }, { id: "geo-z", service_zone_id: "zone-a" }] }] }, activity);
  });

  it("retains complete opaque postal JSON through virtual preimage paths and authenticates its Geo membership", async () => {
    const receipt = call("serviceZoneListForUpdate", { filters: { id: "zone-a" }, config: {
      select: ["geo_zones.id", "geo_zones.type", "geo_zones.country_code", "geo_zones.province_code", "geo_zones.city", "geo_zones.postal_expression.eq"],
      relations: ["geo_zones", "geo_zones.postal_expression"],
    } }, [{ id: "zone-a", geo_zones: [{ id: "geo-a", type: "zip", country_code: "GB", province_code: "LND", city: "London",
      postal_expression: geo.postal_expression ?? null, service_zone_id: "zone-a" }] }]);
    const activity: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: zone("zone-a") }, { table: "geo_zone", row: geo }],
      relationalReads: [rootRead(["zone-a"], 1), geoRead(["zone-a"], 1)] };
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refused(receipt, { ...activity, relationalReads: [rootRead(["zone-a"], 1)] });
    const complete = geoRead(["zone-a"], 1);
    await refused(receipt, { ...activity, relationalReads: [rootRead(["zone-a"], 1), { table: complete.table, query: complete.query, total: 1, returned: 1 }] });
    for (const orderedIdentities of [[], [{ id: "outside" }], [{ id: "geo-a" }, { id: "geo-a" }]])
      await refused(receipt, { ...activity, relationalReads: [rootRead(["zone-a"], 1), { ...geoRead(["zone-a"], 1), orderedIdentities }] });
    await refused(receipt, { ...activity, observedRows: [{ table: "service_zone", row: zone("zone-a") }, { table: "geo_zone", row: { ...geo, service_zone_id: "outside" } }] });
    await refused({ ...receipt, result: [{ id: "zone-a", geo_zones: [{ id: "geo-a", type: "zip", country_code: "GB", province_code: "LND", city: "London",
      postal_expression: { eq: "SW1" }, service_zone_id: "zone-a" }] }] }, activity);
    await refused({ ...receipt, result: [{ id: "zone-a", geo_zones: [geo], shipping_options: [] }] }, activity);
    await refused(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "geo_zone", row: { ...geo, id: "unqueried-child" } }] });
  });

  it("rejects write/lifecycle activity or event authority attached to an otherwise genuine read receipt", async () => {
    const current = zone("zone-a"), receipt = call("serviceZoneListForUpdate", { filters: { id: "zone-a" }, config: { select: ["name"], relations: [] } }, [{ id: "zone-a", name: "zone-a" }]);
    const activity: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: current }], relationalReads: [rootRead(["zone-a"], 1)] };
    await refused({ ...receipt, mode: "write" }, activity); await refused({ ...receipt, commandName: "serviceZoneCreateForWorkflow" }, activity);
    await refused(receipt, { ...activity, mutations: [{ ordinal: 0, table: "service_zone", operation: "patch", before: current, after: { ...current, name: "forged" } }] });
    await refused(receipt, { ...activity, lifecycle: [{ table: "service_zone", operation: "softDelete", key: { id: "zone-a" }, beforeDeletedAt: null,
      afterDeletedAt: stamp, attemptOrdinal: null, rowAtOperation: current }] });
    await refused({ ...receipt, events: [{ name: "fulfillment.service-zone.updated", metadata: { source: "fulfillment", object: "service_zone", action: "updated" }, data: { id: "zone-a" } }] }, activity);
  });
});
