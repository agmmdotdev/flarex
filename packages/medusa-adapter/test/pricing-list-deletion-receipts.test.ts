import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { validateRelationalRowValues } from "flarex-protocol/internal/relational-schema";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata, compilePricingDefinition } from "../src/modules/pricing/schema";
import { compilePriceListDeletionContracts } from "../src/modules/pricing/list-deletion-input";
import { pricingListDeletionPolicy } from "../src/modules/pricing/list-deletion-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { priceListDeletionComparisonRows, type DeletionScenario } from "./support/logical-price-list-delete-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof pricingListDeletionPolicy>;
const stamp = "2026-01-01T00:00:00.000Z", next = "2026-10-20T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const entries: Array<{ table: string; row: JsonObject }> = [
  { table: "price_list", row: { id: "plist_unit154", title: "unit154", description: "", status: "draft", type: "sale", starts_at: null, ends_at: null, rules_count: 1, ...managed } },
  { table: "price", row: { id: "price_unit154", title: null, currency_code: "USD", amount: "1.0000000000000000000", raw_amount: { value: "1.0000000000000000000", precision: 20 },
    min_quantity: null, raw_min_quantity: null, max_quantity: null, raw_max_quantity: null, rules_count: 1, price_list_id: "plist_unit154", price_set_id: "pset_unit154", ...managed } },
  { table: "price_list_rule", row: { id: "same_unit154", price_list_id: "plist_unit154", attribute: "unit154", value: ["v154"], ...managed, deleted_at: stamp } },
  { table: "price_rule", row: { id: "same_unit154", price_id: "price_unit154", attribute: "unit154", value: "v154", operator: "eq", priority: 0, ...managed } },
];
const event = (table: string, id: Json, action: string): Json => ({ name: "pricing." + table.replaceAll("_", "-") + "." + action,
  metadata: { source: "pricing", object: table, action }, data: { id } });
const read = (table: string, column: string, values: string[], count: number) => ({ table,
  query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values }), total: count, returned: count });
function valid(operation: "softDelete" | "restore" = "softDelete", noop = false): { call: Call; activity: Activity } {
  const before: typeof entries = entries.map(({ table, row }) => ({ table, row: { ...row, deleted_at: operation === "restore" ? noop ? null : stamp : row.deleted_at ?? null } }));
  const after: typeof entries = before.map(({ table, row }) => ({ table, row: { ...row,
    deleted_at: operation === "restore" ? null : next, updated_at: noop ? stamp : next } }));
  const mutations: Activity["mutations"] = noop ? [] : before.map(({ table, row }, ordinal) => ({ ordinal, table, operation: "patch", before: row, after: after[ordinal]!.row }));
  const lifecycle: Activity["lifecycle"] = before.map(({ table, row }, ordinal) => {
    const id = row.id, deleted = row.deleted_at;
    if (typeof id !== "string" || deleted !== null && typeof deleted !== "string") throw new Error("Invalid unit identity/lifecycle state");
    return { table, operation, key: { id }, beforeDeletedAt: deleted, afterDeletedAt: operation === "restore" ? null : next,
      attemptOrdinal: noop ? null : ordinal, rowAtOperation: after[ordinal]!.row };
  });
  const activity: Activity = { observedRows: after, mutations, lifecycle, setNull: [], referenceReplacements: [], relationalReads: [
    read("price_list", "id", ["plist_unit154"], 1), read("price", "price_list_id", ["plist_unit154"], 1),
    read("price_rule", "price_id", ["price_unit154"], 1), read("price_list_rule", "price_list_id", ["plist_unit154"], 1),
  ] };
  const result: Json = { price_list_id: ["plist_unit154"], price_id: ["price_unit154"], PriceListRule: [after[2]!.row], price_rule_id: ["same_unit154"] };
  const call: Call = { commandName: operation === "restore" ? "pricingListRestoreForWorkflow" : "pricingListSoftDeleteForWorkflow", mode: "write",
    input: ["plist_unit154"], result, events: operation === "restore" ? [] : before.map(({ table, row }) => event(table, row.id!, row.deleted_at === null ? "deleted" : "updated")),
    fromAttempt: 0, toAttempt: mutations.length, fromLifecycle: 0, toLifecycle: lifecycle.length };
  return { call, activity };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => { policy = pricingListDeletionPolicy(Result.getOrThrow(compilePriceListDeletionContracts((await Effect.runPromise(capturePricingMetadata())).frame))); });

describe("approved portable Price List deletion receipts", () => {
  it("validates every complete canonical comparison row before connected initialization", async () => {
    const definition = await Effect.runPromise(compilePricingDefinition()), metadata = await Effect.runPromise(capturePricingMetadata());
    for (const scenario of ["maximum", "history", "mixed-history", "collision", "same-model-id"] satisfies DeletionScenario[]) {
      const cohort = priceListDeletionComparisonRows(scenario);
      expect(cohort.seedRows).toHaveLength(cohort.sourceRows.length); expect(new Set(cohort.seedRows).size).toBe(cohort.sourceRows.length);
      expect(cohort.seedRows.every(entry => cohort.sourceRows.includes(entry))).toBe(true);
      if (scenario === "maximum") expect(cohort.seedRows).toHaveLength(43);
      // Assert the fixture's six stable contiguous families, not a second
      // implementation of the core initializer or a guessed operation count.
      expect(cohort.seedRows.filter((entry, index) => index === 0 || cohort.seedRows[index - 1]?.table !== entry.table).map(entry => entry.table))
        .toEqual(["price_set", "price_list", "price_list_rule", "price", "price_rule", "price_preference"]);
      for (const table of cohort.initializationTableOrder) {
        expect(cohort.seedRows.filter(entry => entry.table === table)).toEqual(cohort.sourceRows.filter(entry => entry.table === table));
        const compiled = metadata.frame.tables.find(candidate => candidate.name === table);
        if (!compiled) throw new Error("Unknown initialization metadata table: " + table);
        for (const foreign of compiled.foreignKeys) if (foreign.referencedTable !== table) {
          const parent = cohort.initializationTableOrder.indexOf(foreign.referencedTable);
          expect(parent).toBeGreaterThanOrEqual(0); expect(parent).toBeLessThan(cohort.initializationTableOrder.indexOf(table));
        }
      }
      for (const entry of cohort.seedRows) {
        const table = definition.schema.tables.find(table => table.identity.tableId === entry.table);
        if (!table) throw new Error("Unknown deletion fixture table: " + entry.table);
        await Effect.runPromise(Effect.fromResult(validateRelationalRowValues(table, entry.row)).pipe(Effect.mapError(cause =>
          new Error("Invalid deletion seed " + scenario + "/" + entry.table + "/" + entry.row.id, { cause }))));
      }
    }
  });
  it("binds mixed-history classifier actions and exact table order with table-qualified same IDs", async () => {
    const { call, activity } = valid(); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    await refused({ ...call, events: [event("price_list", ["plist_unit154", "price_unit154"], "deleted"), ...call.events.slice(2)] }, activity);
    await refused({ ...call, events: call.events.map((item, index) => index === 0 ? event("price_list", ["plist_unit154"], "deleted") : item) }, activity);
    await refused({ ...call, events: call.events.map((item, index) => index === 2 ? event("price_list_rule", "same_unit154", "deleted") : item) }, activity);
    await refused(call, { ...activity, lifecycle: [activity.lifecycle[0]!, activity.lifecycle[2]!, activity.lifecycle[1]!, activity.lifecycle[3]!] });
    await refused(call, { ...activity, relationalReads: [...activity.relationalReads].reverse() });
  });
  it("refuses coalescing two adjacent scalar Price envelopes into one array-ID envelope", async () => {
    const { call, activity } = valid(), before: JsonObject = { ...entries[1]!.row, id: "price_unit154b", rules_count: 0 };
    const after: JsonObject = { ...before, deleted_at: next, updated_at: next };
    const mutations: Activity["mutations"] = [activity.mutations[0]!, activity.mutations[1]!,
      { ordinal: 2, table: "price", operation: "patch", before, after },
      ...activity.mutations.slice(2).map(change => ({ ...change, ordinal: change.ordinal + 1 }))];
    const lifecycle: Activity["lifecycle"] = [activity.lifecycle[0]!, activity.lifecycle[1]!,
      { table: "price", operation: "softDelete", key: { id: "price_unit154b" }, beforeDeletedAt: null, afterDeletedAt: next, attemptOrdinal: 2, rowAtOperation: after },
      ...activity.lifecycle.slice(2).map(change => ({ ...change, attemptOrdinal: change.attemptOrdinal === null ? null : change.attemptOrdinal + 1 }))];
    const complete: Activity = { ...activity, mutations, lifecycle, observedRows: [...activity.observedRows, { table: "price", row: after }],
      relationalReads: [read("price_list", "id", ["plist_unit154"], 1), read("price", "price_list_id", ["plist_unit154"], 2),
        read("price_rule", "price_id", ["price_unit154"], 1), read("price_rule", "price_id", ["price_unit154b"], 0), read("price_list_rule", "price_list_id", ["plist_unit154"], 1)] };
    const events = [call.events[0]!, call.events[1]!, event("price", "price_unit154b", "deleted"), ...call.events.slice(2)];
    const validCall: Call = { ...call, result: { price_list_id: ["plist_unit154"], price_id: ["price_unit154", "price_unit154b"],
      PriceListRule: [activity.observedRows[2]!.row], price_rule_id: ["same_unit154"] }, events, toAttempt: 5, toLifecycle: 5 };
    await Effect.runPromise(policy.validateLogicalCall(validCall, complete));
    await refused({ ...validCall, events: [events[0]!, event("price", ["price_unit154", "price_unit154b"], "deleted"), ...events.slice(3)] }, complete);
  });
  it("authenticates unmapped complete ListRule objects and refuses an ID-array or forged scalar", async () => {
    const { call, activity } = valid();
    await refused({ ...call, result: { price_list_id: ["plist_unit154"], price_id: ["price_unit154"], PriceListRule: ["same_unit154"], price_rule_id: ["same_unit154"] } }, activity);
    await refused({ ...call, result: { price_list_id: ["plist_unit154"], price_id: ["price_unit154"], PriceListRule: [{ ...entries[2]!.row, deleted_at: next, updated_at: next, attribute: "forged154" }], price_rule_id: ["same_unit154"] } }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.slice(0, 3) });
    await refused(call, { ...activity, observedRows: activity.observedRows.filter(item => item.table !== "price_list_rule") });
  });
  it("requires exact raw selectors, owned complete closure and lifecycle-only mutations", async () => {
    const { call, activity } = valid();
    await refused({ ...call, input: ["unrelated154"] }, activity);
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "price_set", row: { id: "outside154", ...managed } }] });
    await refused(call, { ...activity, mutations: activity.mutations.map((change, index) => index === 1 ? { ...change, after: { ...change.after, currency_code: "forged154" } } : change) });
  });
  it("accepts changed restores and selected active no-ops while requiring zero restore events", async () => {
    for (const noop of [false, true]) {
      const { call, activity } = valid("restore", noop); await Effect.runPromise(policy.validateLogicalCall(call, activity));
      await refused({ ...call, events: [event("price_list", "plist_unit154", "updated")] }, activity);
    }
  });
  it("accepts empty and missing-root maps without invented transitions or events", async () => {
    const activity: Activity = { observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [] };
    const call: Call = { commandName: "pricingListSoftDeleteForWorkflow", mode: "write", input: [], result: {}, events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [""] }, { ...activity, relationalReads: [read("price_list", "id", [""], 0)] }));
    await refused({ ...call, events: [event("price_list", "missing154", "deleted")] }, activity);
  });
});
