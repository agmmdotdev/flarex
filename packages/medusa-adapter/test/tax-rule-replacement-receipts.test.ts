import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureCommerceInput } from "../src/value/input";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { prepareTaxRuleReplacementRepository } from "../src/modules/tax/rule-replacement-repository";
import { taxRuleReplacementPolicy } from "../src/modules/tax/rule-replacement-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let prepared: Result.Result.Success<ReturnType<typeof prepareTaxRuleReplacementRepository>>;
let policy: ReturnType<typeof taxRuleReplacementPolicy>;
const stamp = "2020-01-02T03:04:05.000Z";
const row = (id: string, rate = "rate167"): JsonObject => ({ id, tax_rate_id: rate, reference: "product", reference_id: id,
  metadata: { retained: [null, 1] }, created_by: "creator167", created_at: stamp, updated_at: stamp, deleted_at: null });
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
function listing(ids: string[] = ["rate167"]): { call: Call; activity: Activity } {
  const input = { filters: { tax_rate_id: ids }, config: { select: ["id"] } };
  const plan = Result.getOrThrow(captureCommerceInput(buildQuery(input.filters, { select: ["id"], order: { id: "ASC" } }))
    .pipe(Result.flatMap(prepared.query)));
  return { call: { commandName: "taxRuleListForReplacement", mode: "read", input,
    result: [{ id: "rule-a" }, { id: "rule-z" }], events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 },
    activity: { ...empty(), observedRows: [row("rule-z"), row("rule-a")].map(value => ({ table: "tax_rate_rule", row: value })),
      relationalReads: [{ table: "tax_rate_rule", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 2, returned: 2 }] } };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => {
  prepared = Result.getOrThrow(prepareTaxRuleReplacementRepository((await Effect.runPromise(captureTaxMetadata())).frame));
  policy = taxRuleReplacementPolicy(prepared);
});

describe("complete native Tax Rule replacement list receipts", () => {
  it("authenticates the entire active selection and ascending projected IDs without rerunning native Tax", async () => {
    const { call, activity } = listing(), native = vi.spyOn(TaxModuleService.prototype, "listTaxRateRules");
    try { await Effect.runPromise(policy.validateLogicalCall(call, activity)); expect(native).not.toHaveBeenCalled(); }
    finally { native.mockRestore(); }
  });
  it("authenticates the active cohort after decoding valid historical and other-Rate support bodies", async () => {
    const { call, activity } = listing();
    const support = [{ ...row("historical-support"), deleted_at: stamp },
      ...Array.from({ length: 9 }, (_, index) => row(`other-rate-support-${index}`, "other-rate"))];
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity,
      observedRows: [...activity.observedRows, ...support.map(value => ({ table: "tax_rate_rule", row: value }))] }));
  });
  it.each([
    ["missing read", (activity: Activity) => ({ ...activity, relationalReads: [] })],
    ["extra read", (activity: Activity) => ({ ...activity, relationalReads: [...activity.relationalReads, ...activity.relationalReads] })],
    ["missing observation", (activity: Activity) => ({ ...activity, observedRows: activity.observedRows.slice(1) })],
    ["truncated return", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, returned: 1 })) })],
    ["incorrect total", (activity: Activity) => ({ ...activity, relationalReads: activity.relationalReads.map(read => ({ ...read, total: 3 })) })],
    ["foreign table", (activity: Activity) => ({ ...activity, observedRows: activity.observedRows.map(value => ({ ...value, table: "tax_rate" })) })],
    ["foreign parent", (activity: Activity) => ({ ...activity, observedRows: activity.observedRows.map(value => ({ ...value, row: { ...value.row, tax_rate_id: "foreign" } })) })],
    ["historical row", (activity: Activity) => ({ ...activity, observedRows: activity.observedRows.map(value => ({ ...value, row: { ...value.row, deleted_at: stamp } })) })],
    ["incomplete row", (activity: Activity) => ({ ...activity, observedRows: [{ table: "tax_rate_rule", row: { id: "rule-a" } }] })],
    ["malformed unselected support", (activity: Activity) => ({ ...activity, observedRows: [...activity.observedRows,
      { table: "tax_rate_rule", row: { id: "malformed-support", tax_rate_id: "other-rate", deleted_at: stamp } }] })],
    ["contradictory unselected support", (activity: Activity) => ({ ...activity, observedRows: [...activity.observedRows,
      { table: "tax_rate_rule", row: row("contradictory-support", "other-rate") },
      { table: "tax_rate_rule", row: { ...row("contradictory-support", "other-rate"), metadata: false } }] })],
    ["contradictory observation", (activity: Activity) => ({ ...activity, observedRows: [...activity.observedRows,
      { table: "tax_rate_rule", row: { ...row("rule-a"), metadata: false } }] })],
    ["selection mutation", (activity: Activity) => ({ ...activity, mutations: [{ ordinal: 0, table: "tax_rate_rule", operation: "delete" as const,
      before: row("rule-a"), after: null }] })],
  ])("refuses %s", async (_name, change) => { const { call, activity } = listing(); await refused(call, change(activity)); });
  it("binds exact projection, ID order, selected Rate identities and event-free read mode", async () => {
    const { call, activity } = listing();
    for (const result of [[], [{ id: "rule-z" }, { id: "rule-a" }], [{ id: "rule-a" }], [{ id: "rule-a" }, { id: "rule-a" }],
      [{ id: "rule-a", tax_rate_id: "rate167" }, { id: "rule-z" }]]) await refused({ ...call, result }, activity);
    await refused({ ...call, input: { filters: { tax_rate_id: ["foreign"] }, config: { select: ["id"] } } }, activity);
    await refused({ ...call, mode: "write" }, activity);
    await refused({ ...call, events: [{ name: "tax.tax-rate-rule.deleted", data: { id: "rule-a" } }] }, activity);
    await refused({ ...call, commandName: "listTaxRates" }, activity);
  });
  it("authenticates complete empty and empty-string no-match lists rather than a skipped dependency", async () => {
    for (const ids of [[], [""], ["missing", "missing"]]) {
      const { call, activity } = listing(ids);
      await Effect.runPromise(policy.validateLogicalCall({ ...call, result: [] }, { ...empty(),
        relationalReads: activity.relationalReads.map(read => ({ ...read, total: 0, returned: 0 })) }));
      await refused({ ...call, result: [] }, empty());
    }
  });
  it("refuses a complete ninth old Rule even when all receipt counts agree", async () => {
    const { call, activity } = listing(), ids = Array.from({ length: 9 }, (_, index) => `rule-${index}`), rows = ids.map(id => row(id));
    await refused({ ...call, result: ids.map(id => ({ id })) }, { ...activity,
      observedRows: rows.map(value => ({ table: "tax_rate_rule", row: value })),
      relationalReads: activity.relationalReads.map(read => ({ ...read, total: 9, returned: 9 })) });
  });
  it("routes each existing native empty lifecycle and physical inverse through its own receipt owner", async () => {
    for (const [commandName, result] of [["taxRuleCreateForWorkflow", []], ["taxRulePhysicalDeleteForWorkflow", null],
      ["taxRuleSoftDeleteForWorkflow", {}], ["taxRuleRestoreForWorkflow", {}]] as const) {
      const { call } = listing();
      await Effect.runPromise(policy.validateLogicalCall({ ...call, commandName, mode: "write", input: [], result }, empty()));
      await refused({ ...call, commandName, mode: "write", input: [], result, events: [{ name: "forged" }] }, empty());
    }
  });
});
