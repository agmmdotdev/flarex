import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingOptionUpdateRepository } from "../src/modules/fulfillment/shipping-option-update-repository";
import { prepareShippingOptionRuleRepository } from "../src/modules/fulfillment/shipping-option-rule-repository";
import { shippingOptionUpdatePolicy } from "../src/modules/fulfillment/shipping-option-update-receipt";
import { captureCommerceInput } from "../src/value/input";
import { commerceRelationReadQuery } from "../src/query/relations";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let prepared: Result.Result.Success<ReturnType<typeof prepareShippingOptionUpdateRepository>>;
let policy: ReturnType<typeof shippingOptionUpdatePolicy>;
const stamp = "2026-10-18T00:00:00.000Z", updated = "2026-10-18T01:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const type: JsonObject = { id: "type", label: "Native", code: "native", description: null, ...managed };
const option: JsonObject = { id: "option", name: "Native", price_type: "flat", service_zone_id: "zone", shipping_profile_id: "profile", provider_id: "manual_manual",
  shipping_option_type_id: "type", data: null, metadata: null, ...managed };
const rule: JsonObject = { id: "rule", attribute: "enabled", operator: "eq", value: "true", shipping_option_id: "option", ...managed };
const empty = (): Activity => ({ observedRows: [], relationalReads: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const call = (commandName: string, input: Json, result: Json): Call => ({ commandName,
  mode: commandName === "shippingOptionUpsertForUpdate" ? "write" : "read", input, result, events: [],
  fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 });
const read = (table: string, predicate: JsonObject, count: number, intrinsic = false): Activity["relationalReads"][number] => ({ table,
  query: commerceRelationReadQuery(defaultCommerceResources, predicate, intrinsic ? { kind: "storageInsertion", direction: "asc" } : "id"),
  total: count, returned: count, ...(intrinsic ? { orderedIdentities: count ? [{ id: "rule" }] : [] } : {}) });
const rootRead = (filters: JsonObject, config: JsonObject = {}, count = 1) => {
  const captured = Result.getOrThrow(captureCommerceInput(buildQuery(filters, config)));
  return read("shipping_option", Result.getOrThrow(prepared.reads.query("shipping_option", captured)).query.predicate, count);
};
const children = () => [
  read("shipping_option_rule", { kind: "and", children: [{ kind: "in", column: "shipping_option_id", values: ["option"] }, { kind: "isNull", column: "deleted_at" }] }, 1, true),
  read("shipping_option_type", { kind: "and", children: [{ kind: "in", column: "id", values: ["type"] }, { kind: "isNull", column: "deleted_at" }] }, 1),
];
const refused = async (value: Call, evidence: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value, evidence))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => {
  const { frame } = await Effect.runPromise(captureServiceZoneCreationMetadata());
  prepared = Result.getOrThrow(prepareShippingOptionUpdateRepository(frame));
  policy = shippingOptionUpdatePolicy(prepared, Result.getOrThrow(prepareShippingOptionRuleRepository(frame, "shipping-option-update")));
});

describe("Shipping Option native update receipts", () => {
  it("authenticates exact scalar preimage reads and refuses extra reads or unrelated observations", async () => {
    const value = call("shippingOptionListForUpdate", { filters: { id: ["option"] }, config: { select: ["name"] } }, [{ id: "option", name: "Native" }]);
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option", row: option }], relationalReads: [rootRead({ id: ["option"] })] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(value, empty());
    await refused(value, { ...evidence, relationalReads: [...evidence.relationalReads, ...evidence.relationalReads] });
    await refused(value, { ...evidence, observedRows: [...evidence.observedRows, { table: "shipping_option_type", row: type }] });
    await refused({ ...value, result: [{ id: "option", name: "forged" }] }, evidence);
  });

  it("authenticates a native scalar mutation and every hydration/identity read", async () => {
    const after = { ...option, name: "Changed", updated_at: updated };
    const value: Call = { ...call("shippingOptionUpsertForUpdate", [{ id: "option", name: "Changed" }], [after]), toAttempt: 1,
      events: [{ name: "fulfillment.shipping-option.updated", metadata: { source: "fulfillment", object: "shipping_option", action: "updated" }, data: { id: "option" } }] };
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option", row: after }, { table: "shipping_option_type", row: type },
      { table: "shipping_option_rule", row: rule }], mutations: [{ ordinal: 0, table: "shipping_option", operation: "patch", before: option, after }],
      relationalReads: [rootRead({ id: ["option"] }, { relations: ["rules", "type"], take: 1 }), ...children(),
        rootRead({ $or: [{ id: "option" }] }), read("shipping_option", { kind: "in", column: "id", values: ["option"] }, 1)] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused({ ...value, events: [] }, evidence);
    await refused({ ...value, result: [{ ...after, metadata: { forged: true } }] }, evidence);
    await refused(value, { ...evidence, relationalReads: evidence.relationalReads.slice(0, -1) });
    await refused(value, { ...evidence, relationalReads: [...evidence.relationalReads, evidence.relationalReads[0]!] });
    const forgedOrder = [...evidence.relationalReads]; forgedOrder[1] = { ...forgedOrder[1]!, orderedIdentities: [{ id: "outside" }] };
    await refused(value, { ...evidence, relationalReads: forgedOrder });
  });

  it("retains the native empty-upsert branch and genuine Manual calculated refusal result", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call("shippingOptionUpsertForUpdate", [], []), empty()));
    const value = call("shippingOptionValidateCalculationForUpdate", [{ id: "option", price_type: "calculated", provider_id: "manual_manual" }], [false]);
    await Effect.runPromise(policy.validateLogicalCall(value, empty()));
    await refused({ ...value, result: [true] }, empty());
    await refused({ ...value, result: [] }, empty());
  });

  it("authenticates final shared-Type batch hydration and refuses stale per-entry relation snapshots", async () => {
    const a = { ...option, id: "a" }, b = { ...option, id: "b" }, afterA = { ...a, updated_at: updated }, afterB = { ...b, updated_at: updated };
    const firstType = { ...type, label: "First write", updated_at: updated }, finalType = { ...type, label: "Final write", updated_at: updated };
    const message = (object: string, id: string): Json => ({ name: "fulfillment." + object.replaceAll("_", "-") + ".updated",
      metadata: { source: "fulfillment", object, action: "updated" }, data: { id } });
    const value: Call = { ...call("shippingOptionUpsertForUpdate", [{ id: "a", type: { id: "type", label: "First write" } },
      { id: "b", type: { id: "type", label: "Final write" } }], [{ ...afterA, type: finalType }, { ...afterB, type: finalType }]), toAttempt: 4,
      events: [message("shipping_option", "a"), message("shipping_option_type", "type"), message("shipping_option", "b")] };
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option", row: afterA }, { table: "shipping_option", row: afterB },
      { table: "shipping_option_type", row: finalType }], mutations: [
      { ordinal: 0, table: "shipping_option_type", operation: "patch", before: type, after: firstType },
      { ordinal: 1, table: "shipping_option", operation: "patch", before: a, after: afterA },
      { ordinal: 2, table: "shipping_option_type", operation: "patch", before: firstType, after: finalType },
      { ordinal: 3, table: "shipping_option", operation: "patch", before: b, after: afterB },
    ], relationalReads: [rootRead({ id: ["a", "b"] }, { relations: ["rules", "type"], take: 2 }, 2),
      read("shipping_option_rule", { kind: "and", children: [{ kind: "in", column: "shipping_option_id", values: ["a", "b"] },
        { kind: "isNull", column: "deleted_at" }] }, 0, true),
      read("shipping_option_type", { kind: "and", children: [{ kind: "in", column: "id", values: ["type"] }, { kind: "isNull", column: "deleted_at" }] }, 1),
      rootRead({ $or: [{ id: "a" }, { id: "b" }] }, {}, 2),
      read("shipping_option", { kind: "in", column: "id", values: ["a"] }, 1),
      read("shipping_option_type", { kind: "in", column: "id", values: ["type"] }, 1),
      read("shipping_option", { kind: "in", column: "id", values: ["b"] }, 1),
      read("shipping_option_type", { kind: "in", column: "id", values: ["type"] }, 1),
      read("shipping_option_type", { kind: "and", children: [{ kind: "in", column: "id", values: ["type"] }, { kind: "isNull", column: "deleted_at" }] }, 1),
    ] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused({ ...value, result: [{ ...afterA, type: firstType }, { ...afterB, type: finalType }] }, evidence);
    await refused({ ...value, result: [afterA, { ...afterB, type: finalType }] }, evidence);
    await refused({ ...value, events: [...value.events, message("shipping_option_type", "type")] }, evidence);
    await refused(value, { ...evidence, relationalReads: evidence.relationalReads.slice(0, -1) });
  });

  it("correlates twenty-four native cumulative deletion operands with twelve actual ordered Rule deletions", async () => {
    const groups = Array.from({ length: 4 }, (_, group) => Array.from({ length: 4 }, (_, index) => "rule-" + group + "-" + index));
    const raw = groups.flatMap((_group, index) => groups.slice(0, index).flat()), ids = [...new Set(raw)];
    const rows = ids.map((id, index) => ({ ...rule, id, shipping_option_id: "option-" + Math.floor(index / 4) }));
    const value: Call = { ...call("shippingOptionRuleDeleteForBatch", raw, null), mode: "write", toAttempt: rows.length,
      events: [{ name: "fulfillment.shipping-option-rule.deleted", metadata: { source: "fulfillment", object: "shipping_option_rule", action: "deleted" },
        data: { id: ids } }] };
    const evidence: Activity = { ...empty(), observedRows: rows.map(row => ({ table: "shipping_option_rule", row })),
      relationalReads: [{ table: "shipping_option_rule", query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "in", column: "id", values: raw }, { kind: "storageInsertion", direction: "asc" }), total: rows.length, returned: rows.length,
      orderedIdentities: ids.map(id => ({ id })) }],
      mutations: rows.map((before, ordinal) => ({ ordinal, table: "shipping_option_rule", operation: "delete", before, after: null })) };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused({ ...value, input: [...raw, "outside"] }, evidence);
    await refused({ ...value, events: [] }, evidence);
    await refused(value, { ...evidence, mutations: evidence.mutations.slice(0, -1) });
  });
});
