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
const parentObservations: Activity["observedRows"] = [
  { table: "service_zone", row: { id: "zone", name: "Zone", fulfillment_set_id: "set", metadata: null, ...managed } },
  { table: "shipping_profile", row: { id: "profile", name: "Profile", type: "default", metadata: null, ...managed } },
  { table: "fulfillment_provider", row: { id: "manual_manual", is_enabled: true, ...managed } },
];
const message = (object: string, action: "created" | "updated" | "deleted", id: string): Json => ({
  name: "fulfillment." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "fulfillment", object, action }, data: { id },
});
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
      { table: "shipping_option_rule", row: rule }, ...parentObservations], mutations: [{ ordinal: 0, table: "shipping_option", operation: "patch", before: option, after }],
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
      { table: "shipping_option_type", row: finalType }, ...parentObservations], mutations: [
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

  it("requires native Type/Option/Rule chronology and complete physical targets", async () => {
    const afterType = { ...type, label: "Changed Type", updated_at: updated };
    const afterOption = { ...option, name: "Changed", updated_at: updated };
    const newRule = { ...rule, id: "new-rule", attribute: "replacement", created_at: updated, updated_at: updated };
    const value: Call = { ...call("shippingOptionUpsertForUpdate", [{ id: "option", name: "Changed", type: { id: "type", label: "Changed Type" },
      rules: [{ attribute: "replacement", operator: "eq", value: true }] }], [{ ...afterOption, type: afterType, rules: [newRule] }]), toAttempt: 4,
      events: [message("shipping_option", "updated", "option"), message("shipping_option_rule", "created", "new-rule"),
        message("shipping_option_type", "updated", "type"), message("shipping_option_rule", "deleted", "rule")] };
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option", row: afterOption },
      { table: "shipping_option_type", row: afterType }, { table: "shipping_option_rule", row: newRule }, ...parentObservations],
      mutations: [
        { ordinal: 0, table: "shipping_option_type", operation: "patch", before: type, after: afterType },
        { ordinal: 1, table: "shipping_option", operation: "patch", before: option, after: afterOption },
        { ordinal: 2, table: "shipping_option_rule", operation: "delete", before: rule, after: null },
        { ordinal: 3, table: "shipping_option_rule", operation: "insert", before: null, after: newRule },
      ], relationalReads: [rootRead({ id: ["option"] }, { relations: ["rules", "type"], take: 1 }), ...children(),
        rootRead({ $or: [{ id: "option" }] }), read("shipping_option", { kind: "in", column: "id", values: ["option"] }, 1),
        read("shipping_option_type", { kind: "in", column: "id", values: ["type"] }, 1),
        read("shipping_option_rule", { kind: "in", column: "shipping_option_id", values: ["option"] }, 1, true),
        read("shipping_option_rule", { kind: "in", column: "id", values: ["new-rule"] }, 0, true),
        read("shipping_option_type", { kind: "and", children: [{ kind: "in", column: "id", values: ["type"] }, { kind: "isNull", column: "deleted_at" }] }, 1),
        { ...read("shipping_option_rule", { kind: "and", children: [{ kind: "in", column: "shipping_option_id", values: ["option"] },
          { kind: "isNull", column: "deleted_at" }] }, 1, true), orderedIdentities: [{ id: "new-rule" }] },
      ] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    const reorder = (indexes: readonly number[]) => indexes.map((index, ordinal) => {
      const change = evidence.mutations[index]; if (change === undefined) throw new Error("Missing mixed mutation fixture");
      return { ...change, ordinal };
    });
    await refused(value, { ...evidence, mutations: reorder([2, 3, 0, 1]) });
    await refused(value, { ...evidence, mutations: reorder([1, 0, 2, 3]) });
    await refused(value, { ...evidence, mutations: reorder([0, 1, 3]) });
    await refused(value, { ...evidence, observedRows: evidence.observedRows.filter(row => row.table !== "fulfillment_provider") });
    await refused(value, { ...evidence, observedRows: evidence.observedRows.map(row => row.table === "shipping_profile"
      ? { ...row, row: { ...row.row, id: "other-profile" } } : row) });
    await refused(value, { ...evidence, observedRows: [...evidence.observedRows,
      { table: "shipping_profile", row: { id: "unrelated-profile", name: "Unrelated", type: "default", metadata: null, ...managed } }] });
    await refused(value, { ...evidence, observedRows: evidence.observedRows.map(row => row.table === "shipping_option_type" ? { ...row, row: type } : row) });
    await refused(value, { ...evidence, mutations: evidence.mutations.map(change => change.table === "shipping_option"
      ? { ...change, before: { ...option, metadata: { stale: true } } } : change) });
    await refused(value, { ...evidence, mutations: [...evidence.mutations,
      { ordinal: 4, table: "shipping_option_rule", operation: "patch", before: newRule, after: { ...newRule, value: "extra" } }] });
    await refused(value, { ...evidence, relationalReads: evidence.relationalReads.slice(0, -1) });
  });

  it("accepts physical historical scalar targets while requiring null active Type hydration", async () => {
    const historicalType = { ...type, id: "historical-type", deleted_at: stamp };
    const after = { ...option, shipping_option_type_id: "historical-type", updated_at: updated };
    const value: Call = { ...call("shippingOptionUpsertForUpdate", [{ id: "option", shipping_profile_id: "profile", type: "historical-type" }],
      [{ ...after, type: null }]), toAttempt: 1, events: [message("shipping_option", "updated", "option")] };
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option", row: after }, { table: "shipping_option_type", row: type },
      { table: "shipping_option_rule", row: rule }, { table: "shipping_option_type", row: historicalType },
      ...parentObservations.map(row => row.table === "shipping_profile" ? { ...row, row: { ...row.row, deleted_at: stamp } } : row)],
      mutations: [{ ordinal: 0, table: "shipping_option", operation: "patch", before: option, after }],
      relationalReads: [rootRead({ id: ["option"] }, { relations: ["rules", "type"], take: 1 }), ...children(),
        rootRead({ $or: [{ id: "option" }] }), read("shipping_option", { kind: "in", column: "id", values: ["option"] }, 1),
        read("shipping_option_type", { kind: "and", children: [{ kind: "in", column: "id", values: ["historical-type"] },
          { kind: "isNull", column: "deleted_at" }] }, 0)],
    };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused({ ...value, result: [{ ...after, type: historicalType }] }, evidence);
    await refused(value, { ...evidence, observedRows: evidence.observedRows.filter(row => row.row.id !== "historical-type") });
    const touchedHistoricalType = { ...historicalType, updated_at: updated };
    await refused(value, { ...evidence,
      observedRows: evidence.observedRows.map(row => row.row.id === "historical-type" ? { ...row, row: touchedHistoricalType } : row),
      mutations: [{ ordinal: 0, table: "shipping_option_type", operation: "patch", before: historicalType, after: touchedHistoricalType },
        ...evidence.mutations.map(change => ({ ...change, ordinal: change.ordinal + 1 }))] });
  });

  it.each([false, true])("authenticates an existing historical Type object patch without reviving it (business change=%s)", async changed => {
    const historicalType = { ...type, id: "historical-type", deleted_at: stamp };
    const storedType = { ...historicalType, _id: "physical-historical-type", _creationTime: 1792281600000 };
    const afterType = { ...historicalType, label: changed ? "Changed historical Type" : "Native", updated_at: updated };
    const storedAfterType = { ...storedType, ...afterType };
    const afterOption = { ...option, shipping_option_type_id: "historical-type", updated_at: updated };
    const suppliedType = { id: "historical-type", ...(changed ? { label: "Changed historical Type" } : {}) };
    const value: Call = { ...call("shippingOptionUpsertForUpdate", [{ id: "option", type: suppliedType }], [{ ...afterOption, type: null }]),
      toAttempt: 2, events: [message("shipping_option", "updated", "option"), message("shipping_option_type", "updated", "historical-type")] };
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option", row: afterOption }, { table: "shipping_option_type", row: type },
      { table: "shipping_option_rule", row: rule }, { table: "shipping_option_type", row: storedAfterType }, ...parentObservations],
      mutations: [{ ordinal: 0, table: "shipping_option_type", operation: "patch", before: storedType, after: storedAfterType },
        { ordinal: 1, table: "shipping_option", operation: "patch", before: option, after: afterOption }],
      relationalReads: [rootRead({ id: ["option"] }, { relations: ["rules", "type"], take: 1 }), ...children(),
        rootRead({ $or: [{ id: "option" }] }), read("shipping_option", { kind: "in", column: "id", values: ["option"] }, 1),
        read("shipping_option_type", { kind: "in", column: "id", values: ["historical-type"] }, 1),
        read("shipping_option_type", { kind: "and", children: [{ kind: "in", column: "id", values: ["historical-type"] },
          { kind: "isNull", column: "deleted_at" }] }, 0)],
    };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    const changedAfter = (patch: JsonObject): Activity => ({ ...evidence,
      observedRows: evidence.observedRows.map(row => row.row.id === "historical-type" ? { ...row, row: { ...storedAfterType, ...patch } } : row),
      mutations: evidence.mutations.map(change => change.table === "shipping_option_type" ? { ...change, after: { ...storedAfterType, ...patch } } : change),
    });
    await refused({ ...value, result: [{ ...afterOption, type: afterType }] }, evidence);
    await refused({ ...value, events: [...value.events].reverse() }, evidence);
    await refused(value, { ...evidence, mutations: [...evidence.mutations].reverse().map((change, ordinal) => ({ ...change, ordinal })) });
    await refused(value, { ...evidence, observedRows: evidence.observedRows.filter(row => row.row.id !== "historical-type") });
    await refused(value, changedAfter({ label: "Unrequested business change" }));
    await refused(value, changedAfter({ _id: "different-physical-identity" }));
    await refused(value, changedAfter({ _creationTime: 1792281600001 }));
    await refused({ ...value, input: [{ id: "option", type: { ...suppliedType, created_at: updated } }] }, changedAfter({ created_at: updated }));
    await refused({ ...value, input: [{ id: "option", type: { ...suppliedType, deleted_at: updated } }] }, changedAfter({ deleted_at: updated }));
    const revived = changedAfter({ deleted_at: null });
    await refused({ ...value, input: [{ id: "option", type: { ...suppliedType, deleted_at: null } }],
      result: [{ ...afterOption, type: { ...afterType, deleted_at: null } }] }, { ...revived,
      relationalReads: revived.relationalReads.map((entry, index) => index === revived.relationalReads.length - 1
        ? { ...entry, total: 1, returned: 1 } : entry) });
    const inserted = changedAfter({ created_at: updated });
    await refused({ ...value, input: [{ id: "option", type: { id: "historical-type", label: afterType.label, code: "native" } }],
      events: [message("shipping_option", "updated", "option"), message("shipping_option_type", "created", "historical-type")] }, { ...inserted,
      mutations: inserted.mutations.map(change => change.table === "shipping_option_type" ? { ...change, operation: "insert", before: null } : change),
      relationalReads: inserted.relationalReads.map((entry, index) => index === inserted.relationalReads.length - 2
        ? { ...entry, total: 0, returned: 0 } : entry) });
  });

  it("preserves key-only and identical surviving Rule no-write behavior", async () => {
    const value = call("shippingOptionUpsertForUpdate", [{ id: "option", rules: [{ id: "rule", value: true }] }], [{ ...option, rules: [rule] }]);
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option", row: option }, { table: "shipping_option_type", row: type },
      { table: "shipping_option_rule", row: rule }], relationalReads: [rootRead({ id: ["option"] }, { relations: ["rules", "type"], take: 1 }), ...children(),
      rootRead({ $or: [{ id: "option" }] }), read("shipping_option", { kind: "in", column: "id", values: ["option"] }, 1),
      read("shipping_option_rule", { kind: "in", column: "shipping_option_id", values: ["option"] }, 1, true),
      read("shipping_option_rule", { kind: "and", children: [{ kind: "in", column: "shipping_option_id", values: ["option"] },
        { kind: "isNull", column: "deleted_at" }] }, 1, true)] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(value, { ...evidence, mutations: [{ ordinal: 0, table: "shipping_option_rule", operation: "patch", before: rule,
      after: { ...rule, updated_at: updated } }] });
  });

  it("distinguishes ordinary Rule checkpoint targets from exact retained-row reconstitution", async () => {
    const restored = { ...rule, updated_at: updated };
    const created = { ...rule, id: "new-rule", attribute: "new", created_at: updated, updated_at: updated };
    const value: Call = { ...call("shippingOptionRuleCreateForBatch", [rule,
      { attribute: "new", operator: "eq", value: true, shipping_option_id: "option" }], [restored, created]), mode: "write", toAttempt: 2,
      events: [message("shipping_option_rule", "created", "rule"), message("shipping_option_rule", "created", "new-rule")] };
    const evidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option_rule", row: restored },
      { table: "shipping_option_rule", row: created }, { table: "shipping_option", row: option }], mutations: [
      { ordinal: 0, table: "shipping_option_rule", operation: "insert", before: null, after: restored },
      { ordinal: 1, table: "shipping_option_rule", operation: "insert", before: null, after: created },
    ] };
    await Effect.runPromise(policy.validateLogicalCall(value, evidence));
    await refused(value, { ...evidence, observedRows: evidence.observedRows.filter(row => row.table !== "shipping_option") });
    const onlyRetained: Call = { ...call("shippingOptionRuleCreateForBatch", [rule], [restored]), mode: "write", toAttempt: 1,
      events: [message("shipping_option_rule", "created", "rule")] };
    const restoredEvidence: Activity = { ...empty(), observedRows: [{ table: "shipping_option_rule", row: restored }],
      mutations: [{ ordinal: 0, table: "shipping_option_rule", operation: "insert", before: null, after: restored }] };
    await Effect.runPromise(policy.validateLogicalCall(onlyRetained, restoredEvidence));
    await refused(onlyRetained, { ...restoredEvidence, observedRows: [...restoredEvidence.observedRows, { table: "shipping_option", row: option }] });
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
