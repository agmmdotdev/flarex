import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileServiceZoneDeletionContracts } from "../src/modules/fulfillment/service-zone-delete-input";
import { serviceZoneDeletionPolicy } from "../src/modules/fulfillment/service-zone-delete-receipt";
import { serviceZoneDeletionGraph, serviceZoneSeedTime } from "./support/logical-service-zone-creation-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof serviceZoneDeletionPolicy>;
const graph = serviceZoneDeletionGraph("zone-delete-receipt", { geos: 1, options: 1, rules: 1 });
const later = "2026-10-18T01:00:00.000Z";
const byTable = new Map(graph.rows.map(value => [value.table, value.row]));
const event = (object: string, id: string, action: string): Json => ({ name: "fulfillment." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "fulfillment", object, action }, data: { id } });
const read = (table: string, column: string, values: string[], count: number) => ({ table, query: { take: defaultCommerceResources.queryRows,
  order: { column: "id", direction: "asc" as const }, predicate: { kind: "in" as const, column, values } }, total: count, returned: count });
const reads = () => [read("service_zone", "id", graph.ids, 1), read("geo_zone", "service_zone_id", graph.ids, 1),
  read("shipping_option", "service_zone_id", graph.ids, 1), read("shipping_option_rule", "shipping_option_id", graph.optionIds, 1)];
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
function transcript(operation: "softDelete" | "restore", historicalChildren = false) {
  const preimages = new Map([...byTable].map(([table, row]) => [table, { ...row,
    deleted_at: (operation === "restore" || historicalChildren && table !== "service_zone") ? serviceZoneSeedTime : null }]));
  const mutations: Activity["mutations"] = ["service_zone", "shipping_option", "geo_zone", "shipping_option_rule"].map((table, ordinal) => {
    const before = preimages.get(table); if (before === undefined) throw new Error("Missing complete lifecycle preimage");
    return { ordinal, table, operation: "patch", before, after: { ...before, updated_at: later, deleted_at: operation === "restore" ? null : later } };
  });
  const activity: Activity = { ...empty(), observedRows: mutations.map(value => {
    if (value.after === null) throw new Error("Missing final pending lifecycle row");
    return { table: value.table, row: value.after };
  }), relationalReads: reads(), mutations,
    lifecycle: mutations.map(mutation => {
      const before = mutation.before;
      if (before === null || typeof before.id !== "string") throw new Error("Missing complete lifecycle identity");
      return { table: mutation.table, operation, key: { id: before.id },
        beforeDeletedAt: typeof before.deleted_at === "string" ? before.deleted_at : null, afterDeletedAt: operation === "restore" ? null : later,
        attemptOrdinal: mutation.ordinal, rowAtOperation: null };
    }) };
  const call: Call = { commandName: operation === "softDelete" ? "serviceZoneSoftDeleteForWorkflow" : "serviceZoneRestoreForWorkflow", mode: "write", input: graph.ids,
    result: { service_zone_id: graph.ids, geo_zone_id: graph.geoIds, shipping_option_id: graph.optionIds, shipping_option_rule_id: graph.ruleIds },
    events: graph.rows.map(value => event(value.table, String(value.row.id), operation === "restore" ? "restored" : "deleted")),
    fromAttempt: 0, toAttempt: 4, fromLifecycle: 0, toLifecycle: 4 };
  return { call, activity };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = serviceZoneDeletionPolicy(Result.getOrThrow(compileServiceZoneDeletionContracts(
  (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame))); });

describe("native Service Zone lifecycle graph receipts", () => {
  it("correlates complete graph transitions, maps and native model-event order independently of FK write order", async () => {
    for (const operation of ["softDelete", "restore"] as const) {
      const { call, activity } = transcript(operation); await Effect.runPromise(policy.validateLogicalCall(call, activity));
      await refused({ ...call, events: [call.events[0]!, call.events[2]!, call.events[1]!, call.events[3]!] }, activity);
      await refused({ ...call, result: { service_zone_id: graph.ids } }, activity);
      await refused({ ...call, result: { service_zone_id: graph.ids, geo_zone_id: graph.geoIds, shipping_option_id: graph.optionIds, shipping_option_rule_id: ["outside"] } }, activity);
      await refused(call, { ...activity, mutations: activity.mutations.slice(0, 3) });
      await refused(call, { ...activity, lifecycle: activity.lifecycle.slice(0, 3) });
    }
  });

  it("requires all complete indexed reads including zero-result branches and rejects wrong selectors/counts", async () => {
    const { call, activity } = transcript("softDelete");
    for (const index of [0, 1, 2, 3]) {
      await refused(call, { ...activity, relationalReads: activity.relationalReads.filter((_value, ordinal) => ordinal !== index) });
      await refused(call, { ...activity, relationalReads: reads().map((value, ordinal) => ordinal === index
        ? read(value.table, value.query.predicate.column, ["outside"], value.total) : value) });
    }
    await refused(call, { ...activity, relationalReads: activity.relationalReads.map(value => ({ ...value, total: 0, returned: 0 })) });
    await refused(call, { ...activity, relationalReads: [...activity.relationalReads, reads()[0]!] });
    const missing: Call = { ...call, input: ["missing"], result: {}, events: [], toAttempt: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(missing, { ...empty(), relationalReads: [read("service_zone", "id", ["missing"], 0)] }));
    await refused(missing, empty());
    await Effect.runPromise(policy.validateLogicalCall({ ...missing, input: [] }, empty()));
  });

  it("retains historical-child re-deletion while refusing descendants reached only through a skipped deleted root", async () => {
    const { call, activity } = transcript("softDelete", true); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    const deletedRoot = { ...graph.rows[0]!.row, deleted_at: serviceZoneSeedTime };
    const skipped: Call = { ...call, result: {}, events: [], toAttempt: 0, toLifecycle: 0 };
    const skippedActivity: Activity = { ...empty(), observedRows: [{ table: "service_zone", row: deletedRoot }], relationalReads: [reads()[0]!] };
    await Effect.runPromise(policy.validateLogicalCall(skipped, skippedActivity));
    await refused(skipped, { ...skippedActivity, observedRows: [...skippedActivity.observedRows, { table: "geo_zone", row: graph.rows[1]!.row }] });
  });

  it("requires actual managed patches for active restoration and refuses invented no-op activity", async () => {
    const { call, activity } = transcript("restore");
    const active: Activity = { ...activity, observedRows: activity.observedRows.map(value => ({ ...value, row: { ...value.row, deleted_at: null } })),
      mutations: activity.mutations.map(value => ({ ...value, before: value.before === null ? null : { ...value.before, deleted_at: null } })),
      lifecycle: activity.lifecycle.map(value => ({ ...value, beforeDeletedAt: null })) };
    await Effect.runPromise(policy.validateLogicalCall(call, active));
    await refused(call, { ...active, mutations: [], lifecycle: active.lifecycle.map(value => ({ ...value, attemptOrdinal: null,
      rowAtOperation: active.observedRows.find(row => row.table === value.table)?.row ?? null })) });
  });

  it("refuses detached child chains, sibling changes, scalar forgery and unmatched lifecycle identities", async () => {
    const { call, activity } = transcript("softDelete");
    for (const [table, foreign] of [["geo_zone", "service_zone_id"], ["shipping_option", "service_zone_id"], ["shipping_option_rule", "shipping_option_id"]] as const)
      await refused(call, { ...activity, observedRows: activity.observedRows.map(value => value.table === table ? { ...value, row: { ...value.row, [foreign]: "outside" } } : value),
        mutations: activity.mutations.map(value => value.table === table ? { ...value, before: value.before === null ? null : { ...value.before, [foreign]: "outside" },
          after: value.after === null ? null : { ...value.after, [foreign]: "outside" } } : value) });
    await refused(call, { ...activity, mutations: activity.mutations.map(value => value.table === "service_zone" ? { ...value, after: { ...value.after, name: "forged" } } : value) });
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "fulfillment_set", row: graph.rows[0]!.row }] });
    await refused(call, { ...activity, lifecycle: [...activity.lifecycle, activity.lifecycle[0]!] });
    await refused({ ...call, mode: "read" }, activity);
  });

  it("correlates changed-row final observations with actual afterimages instead of laundering them through preimages", async () => {
    const { call, activity } = transcript("softDelete"); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    for (const [table, column, forged] of [["service_zone", "name", "forged-observed-name"], ["geo_zone", "service_zone_id", "outside"]] as const)
      await refused(call, { ...activity, observedRows: activity.observedRows.map(value => value.table === table
        ? { ...value, row: { ...value.row, [column]: forged } } : value) });
    const observation = activity.observedRows[0]; if (observation === undefined) throw new Error("Missing actual pending observation");
    await refused(call, { ...activity, observedRows: activity.observedRows.slice(1) });
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity, observedRows: [...activity.observedRows, observation] }));
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { ...observation, row: { ...observation.row, name: "conflicting-duplicate" } }] });
  });
});
