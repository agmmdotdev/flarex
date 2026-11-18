import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { TaxModuleService } from "@medusajs/tax/services";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRateDeletionContracts } from "../src/modules/tax/rate-delete-input";
import { taxRateDeletionPolicy } from "../src/modules/tax/rate-delete-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Transcript = { call: Call; activity: Activity };
type Row = JsonObject & { id: string; deleted_at: string | null };
let policy: ReturnType<typeof taxRateDeletionPolicy>;
const stamp = "2020-01-02T03:04:05.000Z", later = "2026-10-23T00:00:00.000Z";
const region: Row = { id: "region-a", country_code: "us", province_code: null, parent_id: null, provider_id: "tp_system",
  metadata: null, created_by: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const rate: Row = { id: "rate-a", tax_region_id: region.id, rate: 7, code: "RECEIPT169", name: "Receipt Rate",
  is_default: false, is_combinable: false, metadata: { keep: [null, 1] }, created_by: "rate-creator",
  created_at: stamp, updated_at: stamp, deleted_at: null };
const rule = (id: string, deleted_at: string | null = null): Row => ({ id, tax_rate_id: rate.id, reference: "product",
  reference_id: id, metadata: { keep: [null, 1] }, created_by: "rule-creator", created_at: stamp, updated_at: stamp, deleted_at });
const first = rule("rule-a"), historical = rule("rule-z", stamp);
const ids = ["missing", "rate-a", "rate-a", ""];
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (table: "tax_rate" | "tax_rate_rule", id: string, action: "deleted" | "updated" = "deleted"): JsonObject => ({
  name: `tax.${table === "tax_rate" ? "tax-rate" : "tax-rate-rule"}.${action}`, metadata: { source: "tax", object: table, action }, data: { id },
});
function reads(restore = false): Activity["relationalReads"] {
  const selected: JsonObject = { kind: "in", column: "id", values: ids }, parent: JsonObject = { kind: "in", column: "id", values: [region.id] };
  return [{ table: "tax_rate", query: commerceRelationReadQuery(defaultCommerceResources, restore ? selected
    : { kind: "and", children: [selected, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 },
  { table: "tax_region", query: commerceRelationReadQuery(defaultCommerceResources, restore ? parent
    : { kind: "and", children: [parent, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 },
  { table: "tax_rate_rule", query: commerceRelationReadQuery(defaultCommerceResources,
    { kind: "in", column: "tax_rate_id", values: [rate.id] }), total: 2, returned: 2 }];
}
function deletion(): Transcript {
  const rows = [{ table: "tax_rate", row: rate }, { table: "tax_rate_rule", row: first }, { table: "tax_rate_rule", row: historical }];
  return { call: { commandName: "taxRateSoftDeleteForWorkflow", mode: "write", input: ids,
    result: { tax_rate_id: [rate.id], tax_rate_rule_id: [first.id, historical.id] },
    events: [event("tax_rate", "rate-a"), event("tax_rate_rule", "rule-a"), event("tax_rate_rule", "rule-z", "updated")],
    fromAttempt: 0, toAttempt: 3, fromLifecycle: 0, toLifecycle: 3 }, activity: { ...empty(),
    mutations: rows.map(({ table, row }, ordinal) => ({ ordinal, table, operation: "patch", before: row,
      after: { ...row, deleted_at: later, updated_at: later } })),
    observedRows: [{ table: "tax_region", row: region }, ...rows.map(({ table, row }) => ({ table, row: { ...row, deleted_at: later, updated_at: later } }))],
    lifecycle: rows.map(({ table, row }, ordinal) => ({ table, operation: "softDelete", key: { id: row.id },
      beforeDeletedAt: row.deleted_at ?? null, afterDeletedAt: later, attemptOrdinal: ordinal, rowAtOperation: null })), relationalReads: reads() } };
}
function restoration(): Transcript {
  const deleted = { ...rate, deleted_at: stamp }, before = { ...first, deleted_at: stamp }, rows = [
    { table: "tax_rate", row: deleted }, { table: "tax_rate_rule", row: before }, { table: "tax_rate_rule", row: historical },
  ];
  return { call: { commandName: "taxRateRestoreForWorkflow", mode: "write", input: ids,
    result: { tax_rate_id: [rate.id], tax_rate_rule_id: [first.id, historical.id] }, events: [],
    fromAttempt: 0, toAttempt: 3, fromLifecycle: 0, toLifecycle: 3 }, activity: { ...empty(),
    mutations: rows.map(({ table, row }, ordinal) => ({ ordinal, table, operation: "patch", before: row,
      after: { ...row, deleted_at: null, updated_at: later } })),
    observedRows: [{ table: "tax_region", row: region }, ...rows.map(({ table, row }) => ({ table, row: { ...row, deleted_at: null, updated_at: later } }))],
    lifecycle: rows.map(({ table, row }, ordinal) => ({ table, operation: "restore", key: { id: row.id },
      beforeDeletedAt: stamp, afterDeletedAt: null, attemptOrdinal: ordinal, rowAtOperation: null })), relationalReads: reads(true) } };
}
function filteredForward(blockedBy: "rate" | "region"): Transcript {
  const value = deletion();
  return { call: { ...value.call, result: {}, events: [], toAttempt: 0, toLifecycle: 0 }, activity: { ...empty(),
    observedRows: blockedBy === "rate" ? [{ table: "tax_rate", row: { ...rate, deleted_at: stamp } }]
      : [{ table: "tax_rate", row: rate }, { table: "tax_region", row: { ...region, deleted_at: stamp } }],
    relationalReads: reads().slice(0, blockedBy === "rate" ? 1 : 2).map(read => read.table === "tax_rate" && blockedBy === "region"
      ? read : { ...read, total: 0, returned: 0 }) } };
}
const accepted = (value: Transcript) => Effect.runPromise(policy.validateLogicalCall(value.call, value.activity));
const refused = async (value: Transcript) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value.call, value.activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = taxRateDeletionPolicy(Result.getOrThrow(compileTaxRateDeletionContracts((await Effect.runPromise(captureTaxMetadata())).frame))); });

describe("approved Tax Rate cascade lifecycle receipt correlation", () => {
  it("authenticates complete historical child transitions and native action classification without rerunning business code", async () => {
    const native = vi.spyOn(TaxModuleService.prototype, "softDeleteTaxRates");
    try { await accepted(deletion()); await accepted(restoration()); expect(native).not.toHaveBeenCalled(); } finally { native.mockRestore(); }
  });
  it.each([
    ["missing support read", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.filter(read => read.table !== "tax_region") })],
    ["missing child read", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.filter(read => read.table !== "tax_rate_rule") })],
    ["extra read", (a: Activity) => ({ ...a, relationalReads: [...a.relationalReads, ...a.relationalReads] })],
    ["changed count", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, total: read.total + 1 })) })],
    ["truncated read", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => ({ ...read, returned: 0 })) })],
    ["changed selector", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => read.table !== "tax_rate" ? read : { ...read,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ["rate-a"] }) }) })],
    ["changed child owner", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => read.table !== "tax_rate_rule" ? read : { ...read,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "tax_rate_id", values: ["foreign"] }) }) })],
    ["wrong limit", (a: Activity) => ({ ...a, relationalReads: a.relationalReads.map(read => read.table !== "tax_rate_rule" ? read : { ...read,
      query: commerceRelationReadQuery({ queryRows: 1 }, { kind: "in", column: "tax_rate_id", values: ["rate-a"] }) }) })],
    ["missing historical child", (a: Activity) => ({ ...a, observedRows: a.observedRows.filter(value => value.row.id !== historical.id) })],
    ["foreign support body", (a: Activity) => ({ ...a, observedRows: [...a.observedRows, { table: "tax_region", row: { ...region, id: "foreign" } }] })],
    ["unknown table", (a: Activity) => ({ ...a, observedRows: [...a.observedRows, { table: "tax_provider", row: { id: "tp_system" } }] })],
    ["missing transition", (a: Activity) => ({ ...a, lifecycle: a.lifecycle.slice(1) })],
    ["reordered transitions", (a: Activity) => ({ ...a, lifecycle: [...a.lifecycle].reverse() })],
    ["duplicate transition", (a: Activity) => ({ ...a, lifecycle: [...a.lifecycle, ...a.lifecycle.slice(0, 1)] })],
    ["missing mutation", (a: Activity) => ({ ...a, mutations: a.mutations.slice(1) })],
    ["incorrect ordinal", (a: Activity) => ({ ...a, mutations: a.mutations.map(value => ({ ...value, ordinal: value.ordinal + 1 })) })],
    ["changed previous deletion", (a: Activity) => ({ ...a, lifecycle: a.lifecycle.map(value => value.key.id === historical.id ? { ...value, beforeDeletedAt: null } : value) })],
    ["Region write", (a: Activity): Activity => ({ ...a, mutations: [...a.mutations, { ordinal: a.mutations.length, table: "tax_region", operation: "patch", before: region, after: { ...region, metadata: {} } }] })],
  ])("refuses %s", async (_name, change) => { const value = deletion(); await refused({ ...value, activity: change(value.activity) }); });
  it("requires complete preimages, current rows and unchanged native business data", async () => {
    for (const column of ["code", "name", "metadata", "created_by", "created_at", "tax_region_id", "rate", "is_default", "is_combinable"]) {
      const value = deletion(), firstMutation = value.activity.mutations[0];
      if (firstMutation?.after === null || firstMutation === undefined) throw new Error("Missing Rate mutation");
      const incomplete = { ...firstMutation.after }; delete incomplete[column];
      await refused({ ...value, activity: { ...value.activity, mutations: [{ ...firstMutation, after: incomplete }, ...value.activity.mutations.slice(1)] } });
    }
    const value = deletion();
    await refused({ ...value, activity: { ...value.activity, mutations: value.activity.mutations.map(mutation => mutation.after === null ? mutation :
      { ...mutation, after: { ...mutation.after, metadata: { changed: true } } }) } });
  });
  it("binds Rate-first maps, Rule IDs and historical updated events exactly", async () => {
    const value = deletion();
    for (const result of [{}, { tax_rate_id: [rate.id] }, { tax_rate_id: [rate.id], tax_rate_rule_id: [historical.id, first.id] },
      { tax_rate_id: [rate.id], tax_rate_rule_id: [first.id, first.id] }, { tax_rate_id: ["foreign"], tax_rate_rule_id: [first.id, historical.id] }])
      await refused({ ...value, call: { ...value.call, result } });
    for (const events of [[], [...value.call.events].reverse(), value.call.events.slice(1), [...value.call.events, event("tax_rate", "foreign")],
      [event("tax_rate", "rate-a"), event("tax_rate_rule", "rule-a"), event("tax_rate_rule", "rule-z")]])
      await refused({ ...value, call: { ...value.call, events } });
  });
  it("preserves historical Region support for restore and refuses forward inclusion beneath a deleted Region", async () => {
    const value = restoration(); await accepted({ ...value, activity: { ...value.activity,
      observedRows: value.activity.observedRows.map(item => item.table === "tax_region" ? { ...item, row: { ...item.row, deleted_at: stamp } } : item) } });
    const forward = deletion(); await refused({ ...forward, activity: { ...forward.activity,
      observedRows: forward.activity.observedRows.map(item => item.table === "tax_region" ? { ...item, row: { ...item.row, deleted_at: stamp } } : item) } });
  });
  it.each(["rate", "region"] as const)("authenticates complete historical %s point candidates excluded from the active forward query", async blockedBy => {
    const value = filteredForward(blockedBy); await accepted(value);
    // A filtered indexed dependency is not a returned row, affected identity,
    // event or permission to traverse its descendants.
    await refused({ ...value, activity: { ...value.activity, relationalReads: value.activity.relationalReads.map((read, index) =>
      index === value.activity.relationalReads.length - 1 ? { ...read, total: 1, returned: 1 } : read) } });
    await refused({ ...value, call: { ...value.call, result: { tax_rate_id: [rate.id] } } });
    await refused({ ...value, call: { ...value.call, events: [event("tax_rate", rate.id)] } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [...value.activity.observedRows, { table: "tax_rate_rule", row: historical }] } });
    await refused({ ...value, activity: { ...value.activity, relationalReads: [...value.activity.relationalReads, ...reads().slice(2)] } });
    await refused({ ...value, activity: { ...value.activity, observedRows: value.activity.observedRows.map(item =>
      item.table === (blockedBy === "rate" ? "tax_rate" : "tax_region") ? { ...item, row: { ...item.row, deleted_at: null } } : item) } });
  });
  it.each(["rate", "region"] as const)("accepts scalar string JSON metadata on a filtered historical %s candidate", async blockedBy => {
    const value = filteredForward(blockedBy), table = blockedBy === "rate" ? "tax_rate" : "tax_region";
    await accepted({ ...value, activity: { ...value.activity, observedRows: value.activity.observedRows.map(item => item.table === table
      ? { ...item, row: { ...item.row, metadata: "valid scalar JSON metadata" } } : item) } });
  });
  it.each(["rate", "region"] as const)("still validates foreign identities and complete historical %s candidate bodies", async blockedBy => {
    const value = filteredForward(blockedBy), table = blockedBy === "rate" ? "tax_rate" : "tax_region";
    await refused({ ...value, activity: { ...value.activity, observedRows: value.activity.observedRows.map(item => item.table === table
      ? { ...item, row: { ...item.row, id: "foreign" } } : item) } });
    await refused({ ...value, activity: { ...value.activity, observedRows: value.activity.observedRows.map(item => item.table === table
      ? { ...item, row: { ...item.row, created_at: false } } : item) } });
    const body = value.activity.observedRows.find(item => item.table === table);
    if (body === undefined) throw new Error("Missing historical candidate");
    const incomplete = { ...body.row }; delete incomplete.created_at;
    await refused({ ...value, activity: { ...value.activity, observedRows: value.activity.observedRows.map(item => item.table === table
      ? { ...item, row: incomplete } : item) } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [...value.activity.observedRows,
      { ...body, row: { ...body.row, metadata: { contradicts: true } } }] } });
  });
  it("separates a filtered historical Rate from current membership and Region read authority in a mixed forward graph", async () => {
    const value = deletion(), skipped: Row = { ...rate, id: "rate-z", tax_region_id: "unread-region", deleted_at: stamp }, raw = [rate.id, skipped.id];
    const candidate: Transcript = { call: { ...value.call, input: raw }, activity: { ...value.activity,
      observedRows: [...value.activity.observedRows, { table: "tax_rate", row: skipped }],
      relationalReads: value.activity.relationalReads.map(read => read.table === "tax_rate" ? { ...read,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
          { kind: "in", column: "id", values: raw }, { kind: "isNull", column: "deleted_at" }] }) } : read) } };
    await accepted(candidate);
    await refused({ ...candidate, call: { ...candidate.call, result: { tax_rate_id: [rate.id, skipped.id], tax_rate_rule_id: [first.id, historical.id] } } });
    await refused({ ...candidate, activity: { ...candidate.activity, observedRows: [...candidate.activity.observedRows,
      { table: "tax_region", row: { ...region, id: "unread-region", deleted_at: stamp } }] } });
    await refused({ ...candidate, activity: { ...candidate.activity, observedRows: [...candidate.activity.observedRows,
      { table: "tax_rate_rule", row: { ...historical, id: "orphan-rule", tax_rate_id: skipped.id } }] } });
  });
  it("counts only visible Region support in a mixed active Rate selection without traversing the blocked Rate", async () => {
    const value = deletion(), blockedRegion: Row = { ...region, id: "region-z", deleted_at: stamp },
      blockedRate: Row = { ...rate, id: "rate-z", tax_region_id: blockedRegion.id }, raw = [rate.id, blockedRate.id];
    const candidate: Transcript = { call: { ...value.call, input: raw }, activity: { ...value.activity,
      observedRows: [...value.activity.observedRows, { table: "tax_rate", row: blockedRate }, { table: "tax_region", row: blockedRegion }],
      relationalReads: value.activity.relationalReads.map(read => read.table === "tax_rate" ? { ...read, total: 2, returned: 2,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
          { kind: "in", column: "id", values: raw }, { kind: "isNull", column: "deleted_at" }] }) }
        : read.table === "tax_region" ? { ...read, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
          { kind: "in", column: "id", values: [region.id, blockedRegion.id] }, { kind: "isNull", column: "deleted_at" }] }) } : read) } };
    await accepted(candidate);
    await refused({ ...candidate, activity: { ...candidate.activity, relationalReads: candidate.activity.relationalReads.map(read =>
      read.table === "tax_region" ? { ...read, total: 2, returned: 2 } : read) } });
    await refused({ ...candidate, activity: { ...candidate.activity, observedRows: [...candidate.activity.observedRows,
      { table: "tax_rate_rule", row: { ...historical, id: "blocked-child", tax_rate_id: blockedRate.id } }] } });
    await refused({ ...candidate, activity: { ...candidate.activity, observedRows: candidate.activity.observedRows.map(item =>
      item.row.id === blockedRegion.id ? { ...item, row: { ...item.row, deleted_at: null } } : item) } });
  });
  it("authenticates active no-op restore rows and requires an unaltered operation body", async () => {
    const value = restoration(), active = rate;
    const firstTransition = value.activity.lifecycle[0]; if (firstTransition === undefined) throw new Error("Missing Rate transition");
    const activity: Activity = { ...value.activity, mutations: value.activity.mutations.slice(1).map((mutation, ordinal) => ({ ...mutation, ordinal })),
      observedRows: value.activity.observedRows.map(item => item.table === "tax_rate" ? { ...item, row: active } : item),
      lifecycle: [{ ...firstTransition, beforeDeletedAt: null, attemptOrdinal: null, rowAtOperation: active },
        ...value.activity.lifecycle.slice(1).map(transition => ({ ...transition, attemptOrdinal: transition.attemptOrdinal === null ? null : transition.attemptOrdinal - 1 }))] };
    const call = { ...value.call, toAttempt: 2 }; await accepted({ call, activity });
    await refused({ call, activity: { ...activity, lifecycle: activity.lifecycle.map(transition => transition.rowAtOperation === null ? transition :
      { ...transition, rowAtOperation: { ...transition.rowAtOperation, name: "forged" } }) } });
  });
  it("authenticates empty and missing selections while refusing invented events or graphs", async () => {
    const value = deletion(), call = { ...value.call, input: [], result: {}, events: [], toAttempt: 0, toLifecycle: 0 };
    await accepted({ call, activity: empty() });
    const missing: Transcript = { call: { ...call, input: ["missing"] }, activity: { ...empty(), relationalReads: [{ table: "tax_rate",
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [{ kind: "in", column: "id", values: ["missing"] },
        { kind: "isNull", column: "deleted_at" }] }), total: 0, returned: 0 }] } };
    await accepted(missing); await refused({ ...missing, call: { ...missing.call, events: [event("tax_rate", "missing")] } });
  });
  it("authenticates required empty per-Rate child reads instead of inferring no children", async () => {
    const value = deletion(), rootMutation = value.activity.mutations[0], rootTransition = value.activity.lifecycle[0];
    if (rootMutation === undefined || rootTransition === undefined) throw new Error("Missing Rate transition");
    const candidate: Transcript = { call: { ...value.call, result: { tax_rate_id: [rate.id] }, events: [event("tax_rate", "rate-a")], toAttempt: 1, toLifecycle: 1 },
      activity: { ...value.activity, mutations: [rootMutation], lifecycle: [rootTransition], observedRows: value.activity.observedRows.filter(row => row.table !== "tax_rate_rule"),
        relationalReads: value.activity.relationalReads.map(read => read.table === "tax_rate_rule" ? { ...read, total: 0, returned: 0 } : read) } };
    await accepted(candidate); await refused({ ...candidate, activity: { ...candidate.activity, relationalReads: candidate.activity.relationalReads.slice(0, 2) } });
  });
  it("refuses unsupported commands/read mode and restore module events", async () => {
    const value = deletion(); await refused({ ...value, call: { ...value.call, commandName: "foreign" } });
    await refused({ ...value, call: { ...value.call, mode: "read" } });
    const inverse = restoration(); await refused({ ...inverse, call: { ...inverse.call, events: [event("tax_rate", "rate-a")] } });
  });
});
