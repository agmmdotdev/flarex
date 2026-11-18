import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRuleCreationContracts } from "../src/modules/tax/rule-create-input";
import { taxRuleCreationPolicy } from "../src/modules/tax/rule-create-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof taxRuleCreationPolicy>;
const managed = { created_at: "2026-10-22T00:00:00.000Z", updated_at: "2026-10-22T00:00:00.000Z", deleted_at: null };
const input = [{ tax_rate_id: "txr165-receipt", reference: "product", reference_id: "prod-one", metadata: { retained: true }, created_by: "rule-creator" }];
const first = { tax_rate_id: "txr165-receipt", reference: "product", reference_id: "prod-one", metadata: { retained: true },
  created_by: "rule-creator", id: "txrule165-z-first", ...managed };
const second = { ...first, id: "txrule165-a-second", reference_id: "prod-two" };
const event = (id: string, action: "created" | "deleted" = "created"): JsonObject => ({
  name: `tax.tax-rate-rule.${action}`, metadata: { source: "tax", object: "tax_rate_rule", action }, data: { id },
});
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
function creation(): { call: Call; activity: Activity } {
  return { call: { commandName: "taxRuleCreateForWorkflow", mode: "write", input, result: [first], events: [event("txrule165-z-first")],
    fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 }, activity: { ...empty(),
    mutations: [{ ordinal: 0, table: "tax_rate_rule", operation: "insert", before: null, after: first }],
    observedRows: [{ table: "tax_rate_rule", row: first }] } };
}
function deletion(): { call: Call; activity: Activity } {
  const ids = ["txrule165-a-second", "txrule165-z-first"];
  return { call: { commandName: "taxRulePhysicalDeleteForWorkflow", mode: "write", input: ids, result: null,
    events: [event("txrule165-z-first", "deleted"), event("txrule165-a-second", "deleted")],
    fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 }, activity: { ...empty(),
    mutations: [first, second].map((before, ordinal) => ({ ordinal, table: "tax_rate_rule", operation: "delete", before, after: null })),
    relationalReads: [{ table: "tax_rate_rule", query: commerceRelationReadQuery(defaultCommerceResources,
      { kind: "in", column: "id", values: ids }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }),
      total: 2, returned: 2, orderedIdentities: [{ id: "txrule165-z-first" }, { id: "txrule165-a-second" }] }] } };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure" });
beforeAll(async () => { policy = taxRuleCreationPolicy(Result.getOrThrow(compileTaxRuleCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame))); });

describe("standalone native Tax Rule creation receipts", () => {
  it("binds complete defaults, creator, observations and events without reinvoking native create", async () => {
    const { call, activity } = creation(), native = vi.spyOn(TaxModuleService.prototype, "createTaxRateRules");
    try { await Effect.runPromise(policy.validateLogicalCall(call, activity)); expect(native).not.toHaveBeenCalled(); }
    finally { native.mockRestore(); }
  });
  it("accepts genuine empty create", async () => {
    const { call } = creation(); await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [], result: [], events: [], toAttempt: 0 }, empty()));
  });
  it("binds interleaved positional aliases to one final canonical write and event", async () => {
    const { call, activity } = creation();
    const a = { ...first, metadata: { second: 2 }, created_by: "second" };
    const b = { ...second, metadata: null, created_by: null };
    const inputs = [
      { id: a.id, tax_rate_id: a.tax_rate_id, reference: a.reference, reference_id: a.reference_id, metadata: null, created_by: null },
      { id: b.id, tax_rate_id: b.tax_rate_id, reference: b.reference, reference_id: b.reference_id },
      { id: a.id, tax_rate_id: "later-parent", reference: "later", reference_id: "later", metadata: { second: 2 }, created_by: "second" },
      { id: a.id, tax_rate_id: "third-parent", reference: "third", reference_id: "third", metadata: { third: 3 }, created_by: "third" },
    ];
    const aliased: Call = { ...call, input: inputs, result: [a, b, a, a], events: [event(String(a.id)), event(String(b.id))] };
    const canonical: Activity = { ...activity,
      mutations: [a, b].map((after, ordinal) => ({ ordinal, table: "tax_rate_rule", operation: "insert", before: null, after })),
      observedRows: [a, b].map(row => ({ table: "tax_rate_rule", row })) };
    await Effect.runPromise(policy.validateLogicalCall(aliased, canonical));
    await refused({ ...aliased, result: [a, b, { ...a, created_by: "third" }, a] }, canonical);
    await refused({ ...aliased, input: inputs.map(({ id: _id, ...row }) => row) }, canonical);
    await refused({ ...aliased, events: [...aliased.events, event(String(a.id))] }, canonical);
    await refused(aliased, { ...canonical, mutations: [...canonical.mutations, { ordinal: 2, table: "tax_rate_rule", operation: "insert", before: null, after: a }] });
  });
  it("refuses incomplete, extra, altered or duplicate immediate DTOs", async () => {
    const { call, activity } = creation();
    for (const result of [[], [{ id: "txrule165-z-first" }], [{ ...first, created_by: "parent-creator" }], [{ ...first, extra: true }], [first, first]])
      await refused({ ...call, result }, activity);
  });
  it("binds every supplied value to the actual standalone Rule write", async () => {
    const { call, activity } = creation(), row = input[0]; if (row === undefined) throw new Error("Missing fixed input");
    for (const changed of [{ ...row, tax_rate_id: "foreign" }, { ...row, reference: "other" }, { ...row, reference_id: "other" },
      { ...row, metadata: { retained: false } }, { ...row, created_by: "parent-creator" }]) await refused({ ...call, input: [changed] }, activity);
  });
  it("refuses missing, additional, altered, foreign and non-insert SQL activity", async () => {
    const { call, activity } = creation(), mutation = activity.mutations[0]; if (mutation === undefined) throw new Error("Missing fixed mutation");
    for (const mutations of [[], [mutation, mutation], [{ ...mutation, ordinal: 1 }], [{ ...mutation, table: "tax_rate" }],
      [{ ...mutation, operation: "patch" as const, before: first }], [{ ...mutation, after: { ...first, metadata: null } }],
      [{ ...mutation, realNormalization: { rate: 1 } }]]) await refused(call, { ...activity, mutations });
  });
  it("requires matching complete observations and no unrelated reads", async () => {
    const { call, activity } = creation();
    for (const observedRows of [[], [{ table: "tax_rate_rule", row: { ...first, reference: "other" } }],
      [...activity.observedRows, { table: "tax_rate", row: { id: "foreign" } }]]) await refused(call, { ...activity, observedRows });
    await refused(call, { ...activity, relationalReads: [{ table: "tax_rate", query: {}, total: 0, returned: 0 }] });
  });
  it("rejects missing, additional, wrong-action and foreign event identities", async () => {
    const { call, activity } = creation();
    for (const events of [[], [...call.events, event("foreign")], [event("foreign")], [event("txrule165-z-first", "deleted")],
      [{ ...event("txrule165-z-first"), name: "foreign.created" }]]) await refused({ ...call, events }, activity);
  });
  it("refuses foreign commands, read mode and lifecycle side effects", async () => {
    const { call, activity } = creation(); await refused({ ...call, commandName: "foreign" }, activity); await refused({ ...call, mode: "read" }, activity);
    const { activity: removed } = deletion(); await refused(call, { ...activity, mutations: removed.mutations });
  });
});

describe("prepared candidate Tax Rule inverse insertion-order receipts", () => {
  it("authenticates the complete actual insertion-order identity cohort", async () => {
    const { call, activity } = deletion(); await Effect.runPromise(policy.validateLogicalCall(call, activity));
  });
  it("accepts empty and missing retained cohorts without invented events", async () => {
    const { call, activity } = deletion(), read = activity.relationalReads[0]; if (read === undefined) throw new Error("Missing fixed read");
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [], result: null, events: [] }, empty()));
    await Effect.runPromise(policy.validateLogicalCall({ ...call, events: [] }, { ...empty(), relationalReads: [{ ...read, total: 0, returned: 0, orderedIdentities: [] }] }));
  });
  it.each([
    ["missing read", (activity: Activity) => ({ ...activity, relationalReads: [] })],
    ["missing identities", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(({ orderedIdentities: _ids, ...read }) => read) })],
    ["reversed identities", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, orderedIdentities: [{ id: "txrule165-a-second" }, { id: "txrule165-z-first" }] })) })],
    ["partial identities", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, orderedIdentities: [{ id: "txrule165-z-first" }] })) })],
    ["duplicate identities", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, orderedIdentities: [{ id: "txrule165-z-first" }, { id: "txrule165-z-first" }] })) })],
    ["foreign identities", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, orderedIdentities: [{ id: "foreign" }, { id: "txrule165-a-second" }] })) })],
    ["incorrect count", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, total: 3 })) })],
    ["truncated count", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, returned: 1 })) })],
    ["extra read", (activity: Activity) => ({ ...activity, relationalReads: [...activity.relationalReads, ...activity.relationalReads] })],
    ["changed order", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ["txrule165-a-second", "txrule165-z-first"] }, "id", { includeIdentities: true }) })) })],
    ["redirected selector", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ["foreign"] }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }) })) })],
    ["truncated query", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, query: commerceRelationReadQuery({ queryRows: 1 }, { kind: "in", column: "id", values: ["txrule165-a-second", "txrule165-z-first"] }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }) })) })],
    ["missing mutation", (activity: Activity) => ({ ...activity, mutations: activity.mutations.slice(1) })],
    ["reversed deletion", (activity: Activity) => ({ ...activity, mutations: [...activity.mutations].reverse().map((mutation, ordinal) => ({ ...mutation, ordinal })) })],
    ["foreign observation", (activity: Activity) => ({ ...activity, observedRows: [{ table: "tax_rate", row: { id: "foreign" } }] })],
    ["altered preimage", (activity: Activity) => ({ ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, before: { ...mutation.before, reference: "other" } })), observedRows: [{ table: "tax_rate_rule", row: first }] })],
    ["incorrect ordinal", (activity: Activity) => ({ ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, ordinal: mutation.ordinal + 1 })) })],
  ])("refuses %s", async (_name, change) => { const { call, activity } = deletion(); await refused(call, change(activity)); });
  it("binds inverse events to actual ordered deleted IDs", async () => {
    const { call, activity } = deletion();
    for (const events of [[], [...call.events].reverse(), [...call.events, event("foreign", "deleted")], [event("foreign", "deleted")]])
      await refused({ ...call, events }, activity);
    await refused({ ...call, result: [] }, activity);
  });
});
