import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRuleDeletionContracts } from "../src/modules/tax/rule-delete-input";
import { taxRuleDeletionPolicy } from "../src/modules/tax/rule-delete-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof taxRuleDeletionPolicy>;
const stamp = "2020-01-02T03:04:05.000Z", later = "2026-10-22T00:00:00.000Z";
const row = (id: string, deleted_at: string | null = null): JsonObject & { id: string } => ({ id, tax_rate_id: "txr166-receipt", reference: "product",
  reference_id: id, metadata: { keep: [null, 1] }, created_by: "rule-creator", created_at: stamp, updated_at: stamp, deleted_at });
const first = row("txrule166-z-first"), history = row("txrule166-m-history", stamp), second = row("txrule166-a-second");
const input = ["txrule166-a-second", "txrule166-m-history", "txrule166-z-first", "txrule166-z-first", "missing"];
const event = (id: string): JsonObject => ({ name: "tax.tax-rate-rule.deleted", metadata: { source: "tax", object: "tax_rate_rule", action: "deleted" }, data: { id } });
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const query = (values: readonly string[] = input) => commerceRelationReadQuery(defaultCommerceResources,
  { kind: "in", column: "id", values }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true });
function deletion(): { call: Call; activity: Activity } {
  const selected = [first, history, second], changed = [first, second];
  return { call: { commandName: "taxRuleSoftDeleteForWorkflow", mode: "write", input,
    result: { tax_rate_rule_id: [first.id, second.id] }, events: [event(String(first.id)), event(String(second.id))],
    fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 2 }, activity: { ...empty(),
    mutations: changed.map((before, ordinal) => ({ ordinal, table: "tax_rate_rule", operation: "patch", before,
      after: { ...before, deleted_at: later, updated_at: later } })),
    observedRows: selected.map(value => ({ table: "tax_rate_rule", row: value.deleted_at === null ? { ...value, deleted_at: later, updated_at: later } : value })),
    lifecycle: changed.map((value, ordinal) => ({ table: "tax_rate_rule", operation: "softDelete", key: { id: value.id },
      beforeDeletedAt: null, afterDeletedAt: later, attemptOrdinal: ordinal, rowAtOperation: null })),
    relationalReads: [{ table: "tax_rate_rule", query: query(), total: 3, returned: 3,
      orderedIdentities: selected.map(value => ({ id: value.id })) }] } };
}
function restoration(): { call: Call; activity: Activity } {
  const before = row("txrule166-z-first", stamp), active = second, after = { ...before, deleted_at: null, updated_at: later };
  return { call: { commandName: "taxRuleRestoreForWorkflow", mode: "write", input: [String(active.id), String(before.id), "missing"],
    result: { tax_rate_rule_id: [before.id, active.id] }, events: [], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 2 },
    activity: { ...empty(), mutations: [{ ordinal: 0, table: "tax_rate_rule", operation: "patch", before, after }],
      observedRows: [{ table: "tax_rate_rule", row: after }, { table: "tax_rate_rule", row: active }],
      lifecycle: [{ table: "tax_rate_rule", operation: "restore", key: { id: before.id }, beforeDeletedAt: stamp,
        afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
      { table: "tax_rate_rule", operation: "restore", key: { id: active.id }, beforeDeletedAt: null,
        afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active }],
      relationalReads: [{ table: "tax_rate_rule", query: query([String(active.id), String(before.id), "missing"]), total: 2, returned: 2,
        orderedIdentities: [{ id: before.id }, { id: active.id }] }] } };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = taxRuleDeletionPolicy(Result.getOrThrow(compileTaxRuleDeletionContracts((await Effect.runPromise(captureTaxMetadata())).frame))); });

describe("candidate Tax Rule deletion historical insertion-order receipts", () => {
  it("authenticates complete history, active-only writes, affected IDs and deletion events without rerunning native code", async () => {
    const { call, activity } = deletion(), native = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRateRules");
    try { await Effect.runPromise(policy.validateLogicalCall(call, activity)); expect(native).not.toHaveBeenCalled(); } finally { native.mockRestore(); }
  });
  it.each([
    ["missing read", (a: Activity) => ({ ...a, relationalReads: [] })],
    ["missing identities", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(({ orderedIdentities: _ids, ...read }) => read) })],
    ["reversed identities", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, orderedIdentities: [...read.orderedIdentities ?? []].reverse() })) })],
    ["omitted history identity", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, orderedIdentities: [{ id: first.id }, { id: second.id }] })) })],
    ["duplicate identities", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, orderedIdentities: [{ id: first.id }, { id: first.id }, { id: second.id }] })) })],
    ["foreign identities", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, orderedIdentities: [{ id: "foreign" }, { id: history.id }, { id: second.id }] })) })],
    ["incorrect total", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, total: 4 })) })],
    ["truncated return", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, returned: 2 })) })],
    ["extra read", (a: Activity) => ({ ...a, relationalReads: [...a.relationalReads, ...a.relationalReads] })],
    ["changed order", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, query: commerceRelationReadQuery(defaultCommerceResources,
      { kind: "in", column: "id", values: input }, "id", { includeIdentities: true }) })) })],
    ["redirected selector", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, query: query(["foreign"]) })) })],
    ["truncated query", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, query: commerceRelationReadQuery({ queryRows: 1 },
      { kind: "in", column: "id", values: input }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }) })) })],
    ["missing transition", (a: Activity) => ({ ...a, lifecycle: a.lifecycle.slice(1) })],
    ["reversed transitions", (a: Activity) => ({ ...a, lifecycle: [...a.lifecycle].reverse() })],
    ["missing mutation", (a: Activity) => ({ ...a, mutations: a.mutations.slice(1) })],
    ["foreign observation", (a: Activity) => ({ ...a, observedRows: [...a.observedRows, { table: "tax_rate", row: { id: "foreign" } }] })],
    ["incorrect ordinal", (a: Activity) => ({ ...a, mutations: a.mutations.map(mutation => ({ ...mutation, ordinal: mutation.ordinal + 1 })) })],
  ])("refuses %s", async (_name, change) => { const { call, activity } = deletion(); await refused(call, change(activity)); });
  it("refuses history mutation, changed parent/content and physical deletion", async () => {
    const { call, activity } = deletion(), mutation = activity.mutations[0]; if (mutation === undefined || mutation.after === null) throw new Error("Missing receipt mutation");
    for (const change of [{ tax_rate_id: "foreign" }, { reference: "other" }, { reference_id: "other" }, { metadata: null }, { created_by: null }, { extra: true }])
      await refused(call, { ...activity, mutations: [{ ...mutation, after: { ...mutation.after, ...change } }, ...activity.mutations.slice(1)] });
    await refused(call, { ...activity, mutations: [{ ...mutation, operation: "delete", after: null }, ...activity.mutations.slice(1)] });
    await refused(call, { ...activity, mutations: [...activity.mutations, { ...mutation, ordinal: 2, before: history, after: { ...history, deleted_at: later, updated_at: later } }] });
  });
  it("binds ordered maps and deleted events to only changed active Rules", async () => {
    const { call, activity } = deletion();
    for (const result of [{}, { tax_rate_rule_id: [second.id, first.id] }, { tax_rate_rule_id: [first.id, history.id, second.id] },
      { tax_rate_rule_id: [first.id, first.id] }, { tax_rate_rule_id: [first.id, second.id], tax_rate_id: ["parent"] }]) await refused({ ...call, result }, activity);
    for (const events of [[], [...call.events].reverse(), [...call.events, event("foreign")], [event(String(first.id))]]) await refused({ ...call, events }, activity);
  });
  it("accepts empty and missing selections with no invented map or events", async () => {
    const { call } = deletion(); await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [], result: {}, events: [], toAttempt: 0, toLifecycle: 0 }, empty()));
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: ["missing"], result: {}, events: [], toAttempt: 0, toLifecycle: 0 },
      { ...empty(), relationalReads: [{ table: "tax_rate_rule", query: query(["missing"]), total: 0, returned: 0, orderedIdentities: [] }] }));
  });
  it("authenticates restore of deleted and active rows, full cached active row and zero restored events", async () => {
    const { call, activity } = restoration(); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, events: [event(String(first.id))] }, activity);
    await refused({ ...call, result: { tax_rate_rule_id: [first.id] } }, activity);
    await refused(call, { ...activity, lifecycle: activity.lifecycle.map(value => ({ ...value, rowAtOperation: null })) });
  });
  it("refuses altered active-restore operation content against the independent original observation", async () => {
    const { call, activity } = restoration();
    await refused(call, { ...activity, lifecycle: activity.lifecycle.map(value => value.rowAtOperation === null ? value :
      { ...value, rowAtOperation: { ...value.rowAtOperation, reference: "altered-operation-content" } }) });
  });
  it("accepts the authenticated active operation row when a closed child omits its unchanged observation", async () => {
    const { call, activity } = restoration();
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity,
      observedRows: activity.observedRows.filter(value => value.row.id !== second.id) }));
  });
  it("refuses foreign commands, read mode and unrelated shared side effects", async () => {
    const { call, activity } = deletion(); await refused({ ...call, commandName: "foreign" }, activity); await refused({ ...call, mode: "read" }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.map(value => ({ ...value, table: "tax_rate" })) });
  });
});
