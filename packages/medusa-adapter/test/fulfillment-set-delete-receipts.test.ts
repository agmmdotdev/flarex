import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentSetDeletionContracts } from "../src/modules/fulfillment/fulfillment-set-delete-input";
import { fulfillmentServiceRouting } from "../src/modules/fulfillment/fulfillment-module";
import { fulfillmentSetDeletionPolicy } from "../src/modules/fulfillment/fulfillment-set-delete-receipt";
import { fulfillmentSetDeletionGraph } from "./support/logical-fulfillment-set-deletion-fixture";
import { serviceZoneSeedTime } from "./support/logical-service-zone-creation-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof fulfillmentSetDeletionPolicy>;
const graph = fulfillmentSetDeletionGraph("set-delete-receipt", { geos: 1, options: 1, rules: 1 });
const later = "2026-10-18T01:00:00.000Z", byTable = new Map(graph.rows.map(value => [value.table, value.row]));
const event = (object: string, id: string, action: string): Json => ({ name: "fulfillment." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "fulfillment", object, action }, data: { id } });
const read = (table: string, column: string, values: string[], count: number) => ({ table, query: { take: defaultCommerceResources.queryRows,
  order: { column: "id", direction: "asc" as const }, predicate: { kind: "in" as const, column, values } }, total: count, returned: count });
const reads = () => [read("fulfillment_set", "id", graph.ids, 1), read("service_zone", "fulfillment_set_id", graph.ids, 1),
  read("geo_zone", "service_zone_id", graph.zoneIds, 1), read("shipping_option", "service_zone_id", graph.zoneIds, 1),
  read("shipping_option_rule", "shipping_option_id", graph.optionIds, 1)];
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
function transcript(operation: "softDelete" | "restore", historicalChildren = false) {
  const preimages = new Map([...byTable].map(([table, row]) => [table, { ...row,
    deleted_at: operation === "restore" || historicalChildren && table !== "fulfillment_set" ? serviceZoneSeedTime : null }]));
  const mutations: Activity["mutations"] = ["fulfillment_set", "service_zone", "shipping_option", "geo_zone", "shipping_option_rule"].map((table, ordinal) => {
    const before = preimages.get(table); if (before === undefined) throw new Error("Missing complete Set lifecycle preimage");
    return { ordinal, table, operation: "patch", before, after: { ...before, updated_at: later, deleted_at: operation === "restore" ? null : later } };
  });
  const activity: Activity = { ...empty(), observedRows: mutations.map(value => {
    if (value.after === null) throw new Error("Missing actual final pending Set lifecycle row"); return { table: value.table, row: value.after };
  }), relationalReads: reads(), mutations, lifecycle: mutations.map(mutation => {
    const before = mutation.before; if (before === null || typeof before.id !== "string") throw new Error("Missing native lifecycle identity");
    return { table: mutation.table, operation, key: { id: before.id }, beforeDeletedAt: typeof before.deleted_at === "string" ? before.deleted_at : null,
      afterDeletedAt: operation === "restore" ? null : later, attemptOrdinal: mutation.ordinal, rowAtOperation: null };
  }) };
  const call: Call = { commandName: operation === "softDelete" ? "fulfillmentSetSoftDeleteForWorkflow" : "fulfillmentSetRestoreForWorkflow", mode: "write", input: graph.ids,
    result: { fulfillment_set_id: graph.ids, service_zone_id: graph.zoneIds, geo_zone_id: graph.geoIds, shipping_option_id: graph.optionIds, shipping_option_rule_id: graph.ruleIds },
    events: graph.rows.map(value => event(value.table, String(value.row.id), operation === "restore" ? "restored" : "deleted")),
    fromAttempt: 0, toAttempt: 5, fromLifecycle: 0, toLifecycle: 5 };
  return { call, activity };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = fulfillmentSetDeletionPolicy(Result.getOrThrow(compileFulfillmentSetDeletionContracts((await Effect.runPromise(captureServiceZoneCreationMetadata())).frame))); });

describe("native complete Fulfillment Set lifecycle receipts", () => {
  it("authenticates the real Link selector/config through the same complete lifecycle receipt", async () => {
    const ids = Array.from({ length: 8 }, () => graph.ids[0]!);
    const config = { returnLinkableKeys: Object.keys(fulfillmentServiceRouting().__joinerConfig.linkableKeys ?? {}) };
    for (const operation of ["softDelete", "restore"] as const) {
      const { call, activity } = transcript(operation);
      const selected = { ...call, input: { selector: { id: ids }, config } };
      const expected = { ...activity, relationalReads: [read("fulfillment_set", "id", ids, 1), ...activity.relationalReads.slice(1)] };
      await Effect.runPromise(policy.validateLogicalCall(selected, expected));
      await refused({ ...selected, input: { selector: { id: ids }, config: { returnLinkableKeys: ["fulfillment_set_id"] } } }, expected);
      await refused(selected, activity);
    }
  });
  it("correlates all five actual model maps and native family event order independently of FK mutation order", async () => {
    for (const operation of ["softDelete", "restore"] as const) {
      const { call, activity } = transcript(operation); await Effect.runPromise(policy.validateLogicalCall(call, activity));
      await refused({ ...call, events: [call.events[0]!, call.events[1]!, call.events[3]!, call.events[2]!, call.events[4]!] }, activity);
      await refused({ ...call, result: { fulfillment_set_id: graph.ids } }, activity);
      await refused({ ...call, result: { fulfillment_set_id: graph.ids, service_zone_id: graph.zoneIds, geo_zone_id: graph.geoIds,
        shipping_option_id: graph.optionIds, shipping_option_rule_id: ["outside"] } }, activity);
      await refused(call, { ...activity, mutations: activity.mutations.slice(0, 4) }); await refused(call, { ...activity, lifecycle: activity.lifecycle.slice(0, 4) });
    }
  });

  it("requires complete Set-to-Zone and descendant indexed reads, including missing and empty branches", async () => {
    const { call, activity } = transcript("softDelete");
    for (const index of [0, 1, 2, 3, 4]) {
      await refused(call, { ...activity, relationalReads: activity.relationalReads.filter((_value, ordinal) => ordinal !== index) });
      await refused(call, { ...activity, relationalReads: reads().map((value, ordinal) => ordinal === index ? read(value.table, value.query.predicate.column, ["outside"], value.total) : value) });
    }
    await refused(call, { ...activity, relationalReads: activity.relationalReads.map(value => ({ ...value, total: 0, returned: 0 })) });
    const missing: Call = { ...call, input: ["missing"], result: {}, events: [], toAttempt: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(missing, { ...empty(), relationalReads: [read("fulfillment_set", "id", ["missing"], 0)] }));
    await refused(missing, empty()); await Effect.runPromise(policy.validateLogicalCall({ ...missing, input: [] }, empty()));
    const root = graph.rows[0]?.row; if (root === undefined) throw new Error("Missing native Set preimage");
    const rootOnly: Call = { ...call, result: { fulfillment_set_id: graph.ids }, events: [call.events[0]!], toAttempt: 1, toLifecycle: 1 };
    const rootActivity: Activity = { ...activity, observedRows: activity.observedRows.filter(value => value.table === "fulfillment_set"), mutations: activity.mutations.slice(0, 1),
      lifecycle: activity.lifecycle.slice(0, 1), relationalReads: [reads()[0]!, read("service_zone", "fulfillment_set_id", graph.ids, 0)] };
    await Effect.runPromise(policy.validateLogicalCall(rootOnly, rootActivity)); await refused(rootOnly, { ...rootActivity, relationalReads: [reads()[0]!] });
  });

  it("re-deletes historical descendants but skips their entire closure when the Set root is already deleted", async () => {
    const { call, activity } = transcript("softDelete", true); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    const root = graph.rows[0]?.row; if (root === undefined) throw new Error("Missing Set preimage");
    const skipped: Call = { ...call, input: [graph.ids[0]!, "missing", graph.ids[0]!], result: {}, events: [], toAttempt: 0, toLifecycle: 0 };
    const selected: Activity = { ...empty(), observedRows: [{ table: "fulfillment_set", row: { ...root, deleted_at: serviceZoneSeedTime } }],
      relationalReads: [read("fulfillment_set", "id", [graph.ids[0]!, "missing", graph.ids[0]!], 1)] };
    await Effect.runPromise(policy.validateLogicalCall(skipped, selected));
    await refused(skipped, { ...selected, relationalReads: [...selected.relationalReads, reads()[1]!] });
    await refused(skipped, { ...selected, observedRows: [...selected.observedRows, { table: "service_zone", row: graph.rows[1]!.row }] });
    const restored = transcript("restore"); await Effect.runPromise(policy.validateLogicalCall({ ...restored.call, input: skipped.input }, {
      ...restored.activity, relationalReads: [read("fulfillment_set", "id", [graph.ids[0]!, "missing", graph.ids[0]!], 1), ...reads().slice(1)],
    }));
  });

  it("requires managed patches for genuine active restoration across every reached model", async () => {
    const { call, activity } = transcript("restore");
    const active: Activity = { ...activity, mutations: activity.mutations.map(value => ({ ...value, before: value.before === null ? null : { ...value.before, deleted_at: null } })),
      lifecycle: activity.lifecycle.map(value => ({ ...value, beforeDeletedAt: null })) };
    await Effect.runPromise(policy.validateLogicalCall(call, active));
    await refused(call, { ...active, mutations: [], lifecycle: active.lifecycle.map(value => ({ ...value, attemptOrdinal: null,
      rowAtOperation: active.observedRows.find(row => row.table === value.table)?.row ?? null })) });
  });

  it("rejects changed-row forged final observations while retaining genuine equal observations", async () => {
    const { call, activity } = transcript("softDelete"); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    for (const [table, column, forged] of [["fulfillment_set", "name", "forged-observed-name"], ["service_zone", "fulfillment_set_id", "outside"],
      ["geo_zone", "service_zone_id", "outside"], ["shipping_option_rule", "shipping_option_id", "outside"]] as const)
      await refused(call, { ...activity, observedRows: activity.observedRows.map(value => value.table === table ? { ...value, row: { ...value.row, [column]: forged } } : value) });
    const observation = activity.observedRows[0]; if (observation === undefined) throw new Error("Missing final pending observation");
    await refused(call, { ...activity, observedRows: activity.observedRows.slice(1) });
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity, observedRows: [...activity.observedRows, observation] }));
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { ...observation, row: { ...observation.row, name: "conflicting-duplicate" } }] });
    await refused(call, { ...activity, mutations: activity.mutations.map(value => value.table === "fulfillment_set" ? { ...value, after: { ...value.after, name: "forged-scalar" } } : value) });
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "shipping_profile", row: graph.rows[0]!.row }] });
    await refused({ ...call, mode: "read" }, activity);
  });
});
