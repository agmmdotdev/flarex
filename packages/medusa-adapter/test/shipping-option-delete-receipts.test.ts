import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingOptionDeletionContracts } from "../src/modules/fulfillment/shipping-option-delete-input";
import { shippingOptionDeletionPolicy } from "../src/modules/fulfillment/shipping-option-delete-receipt";
import { serviceZoneDeletionGraph, serviceZoneSeedTime } from "./support/logical-service-zone-creation-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof shippingOptionDeletionPolicy>;
const graph = serviceZoneDeletionGraph("option-delete-receipt", { geos: 1, options: 1, rules: 1 });
const rows = graph.rows.filter(value => value.table === "shipping_option" || value.table === "shipping_option_rule");
const later = "2026-10-18T01:00:00.000Z";
const event = (object: string, id: string, action: string): Json => ({ name: "fulfillment." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "fulfillment", object, action }, data: { id } });
const read = (table: string, column: string, values: string[], count: number) => ({ table, query: { take: defaultCommerceResources.queryRows,
  order: { column: "id", direction: "asc" as const }, predicate: { kind: "in" as const, column, values } }, total: count, returned: count });
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
function transcript(operation: "softDelete" | "restore") {
  const mutations: Activity["mutations"] = rows.map((value, ordinal) => {
    const before = { ...value.row, deleted_at: operation === "restore" ? serviceZoneSeedTime : null };
    return { ordinal, table: value.table, operation: "patch", before,
      after: { ...before, updated_at: later, deleted_at: operation === "restore" ? null : later } };
  });
  const activity: Activity = { ...empty(), observedRows: mutations.map(mutation => {
    if (mutation.after === null) throw new Error("Missing final pending row");
    return { table: mutation.table, row: mutation.after };
  }), relationalReads: [read("shipping_option", "id", graph.optionIds, 1), read("shipping_option_rule", "shipping_option_id", graph.optionIds, 1)],
    mutations, lifecycle: mutations.map(mutation => {
      const before = mutation.before;
      if (before === null || typeof before.id !== "string") throw new Error("Missing lifecycle identity");
      return { table: mutation.table, operation, key: { id: before.id }, beforeDeletedAt: typeof before.deleted_at === "string" ? before.deleted_at : null,
        afterDeletedAt: operation === "restore" ? null : later, attemptOrdinal: mutation.ordinal, rowAtOperation: null };
    }) };
  const call: Call = { commandName: operation === "softDelete" ? "shippingOptionSoftDeleteForWorkflow" : "shippingOptionRestoreForWorkflow",
    mode: "write", input: graph.optionIds, result: { shipping_option_id: graph.optionIds, shipping_option_rule_id: graph.ruleIds },
    events: rows.map(value => event(value.table, String(value.row.id), operation === "restore" ? "restored" : "deleted")),
    fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 2 };
  return { call, activity };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = shippingOptionDeletionPolicy(Result.getOrThrow(compileShippingOptionDeletionContracts(
  (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame))); });

describe("native Option and Rule lifecycle receipts", () => {
  it("correlates complete managed transitions maps and model-event order for deletion and raw-ID restoration", async () => {
    for (const operation of ["softDelete", "restore"] as const) {
      const { call, activity } = transcript(operation); await Effect.runPromise(policy.validateLogicalCall(call, activity));
      await refused({ ...call, result: { shipping_option_id: graph.optionIds } }, activity);
      await refused({ ...call, events: [...call.events].reverse() }, activity);
      await refused(call, { ...activity, mutations: activity.mutations.slice(0, 1) });
      await refused(call, { ...activity, lifecycle: activity.lifecycle.slice(0, 1) });
    }
  });

  it("requires exactly the Option and Rule indexed reads including empty and skipped historical roots", async () => {
    const { call, activity } = transcript("softDelete");
    for (const index of [0, 1]) await refused(call, { ...activity, relationalReads: activity.relationalReads.filter((_value, ordinal) => ordinal !== index) });
    await refused(call, { ...activity, relationalReads: [...activity.relationalReads, read("service_zone", "id", graph.ids, 1)] });
    const missing: Call = { ...call, input: ["missing"], result: {}, events: [], toAttempt: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(missing, { ...empty(), relationalReads: [read("shipping_option", "id", ["missing"], 0)] }));
    await refused(missing, empty());
    await Effect.runPromise(policy.validateLogicalCall({ ...missing, input: [] }, empty()));
    const option = rows.find(row => row.table === "shipping_option"); if (option === undefined) throw new Error("Missing Option");
    await Effect.runPromise(policy.validateLogicalCall({ ...missing, input: graph.optionIds }, { ...empty(),
      observedRows: [{ table: option.table, row: { ...option.row, deleted_at: serviceZoneSeedTime } }],
      relationalReads: [read("shipping_option", "id", graph.optionIds, 1)] }));
  });

  it("rejects scalar forgery detached Rules sibling mutations and mismatched observations", async () => {
    const { call, activity } = transcript("softDelete");
    await refused(call, { ...activity, observedRows: activity.observedRows.map(value => value.table === "shipping_option_rule"
      ? { ...value, row: { ...value.row, shipping_option_id: "outside" } } : value) });
    await refused(call, { ...activity, mutations: activity.mutations.map(value => value.table === "shipping_option"
      ? { ...value, after: { ...value.after, name: "forged" } } : value) });
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "service_zone", row: graph.rows[0]!.row }] });
    await refused({ ...call, mode: "read" }, activity);
  });
});
