import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compilePriceListPriceRemovalContracts, decodePriceListPriceRemovalLifecycleArguments } from "../src/modules/pricing/price-list-price-removal-input";
import { pricingPriceListPriceRemovalPolicy } from "../src/modules/pricing/price-list-price-removal-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compilePriceListPriceRemovalContracts>>;
let policy: ReturnType<typeof pricingPriceListPriceRemovalPolicy>;
const stamp = "2026-01-01T00:00:00.000Z", next = "2026-10-21T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const price = (id: string): JsonObject => ({ id, title: null, currency_code: "usd", amount: "1.0000000000000000000",
  raw_amount: { value: "1.0000000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
  max_quantity: null, raw_max_quantity: null, rules_count: 1, price_list_id: null, price_set_id: "pset157", ...managed });
// Rule IDs intentionally oppose parent order; one ID occurs in both tables.
const entries: Array<{ table: string; row: JsonObject }> = [
  { table: "price", row: price("price-a157") }, { table: "price", row: price("price-b157") },
  { table: "price_rule", row: { id: "rule-z157", price_id: "price-a157", attribute: "region", value: "first", operator: "eq", priority: 0, ...managed } },
  { table: "price_rule", row: { id: "price-a157", price_id: "price-b157", attribute: "region", value: "second", operator: "eq", priority: 0, ...managed, deleted_at: stamp } },
];
const event = (table: string, id: Json, action: string): Json => ({ name: "pricing." + table.replaceAll("_", "-") + "." + action,
  metadata: { source: "pricing", object: table, action }, data: { id } });
const read = (table: string, column: string, values: string[], count: number) => ({ table,
  query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values }), total: count, returned: count });
function valid(operation: "softDelete" | "restore" = "softDelete", noop = false): { call: Call; activity: Activity } {
  const before: Array<{ table: string; row: JsonObject }> = entries.map(({ table, row }) => ({ table,
    row: { ...row, deleted_at: operation === "restore" ? noop ? null : stamp : row.deleted_at ?? null } }));
  const after = before.map(({ table, row }) => ({ table, row: { ...row,
    deleted_at: operation === "restore" ? null : next, updated_at: noop ? stamp : next } }));
  const mutations: Activity["mutations"] = noop ? [] : before.map(({ table, row }, ordinal) =>
    ({ ordinal, table, operation: "patch", before: row, after: after[ordinal]!.row }));
  const lifecycle: Activity["lifecycle"] = before.map(({ table, row }, ordinal) => {
    const id = row.id, deleted = row.deleted_at;
    if (typeof id !== "string" || deleted !== null && typeof deleted !== "string") throw new Error("Invalid lifecycle fixture");
    return { table, operation, key: { id }, beforeDeletedAt: deleted, afterDeletedAt: operation === "restore" ? null : next,
      attemptOrdinal: noop ? null : ordinal, rowAtOperation: after[ordinal]!.row };
  });
  const activity: Activity = { observedRows: after, mutations, lifecycle, setNull: [], referenceReplacements: [], relationalReads: [
    read("price", "id", ["price-b157", "price-a157", "price-a157", ""], 2),
    read("price_rule", "price_id", ["price-a157"], 1), read("price_rule", "price_id", ["price-b157"], 1),
  ] };
  const call: Call = { commandName: operation === "restore" ? "pricingPriceRestoreForRemovalWorkflow" : "pricingPriceSoftDeleteForRemovalWorkflow",
    mode: "write", input: ["price-b157", "price-a157", "price-a157", ""],
    result: { price_id: ["price-a157", "price-b157"], price_rule_id: ["rule-z157", "price-a157"] },
    events: operation === "restore" ? [] : before.map(({ table, row }) => event(table, row.id!, row.deleted_at === null ? "deleted" : "updated")),
    fromAttempt: 0, toAttempt: mutations.length, fromLifecycle: 0, toLifecycle: lifecycle.length };
  return { call, activity };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
function readCase(): { call: Call; activity: Activity } {
  const selected = { ...price("price-a157"), price_list_id: "plist-historical157" };
  const excluded = { ...price("price-b157"), price_set_id: "pset-historical157" };
  const set = { id: "pset157", ...managed };
  const input = { filters: { id: ["price-b157", "price-a157", "price-a157"] }, config: { relations: ["price_list"] } };
  const plan = Result.getOrThrow(contracts.compileNativeReadPlan(buildQuery(input.filters,
    { relations: ["price_list"], order: { id: "ASC" } })));
  const queryRead = (table: string, query: JsonObject, ids: string[], identities = false) => ({ table, query,
    total: ids.length, returned: ids.length, ...(identities ? { orderedIdentities: ids.map(id => ({ id })) } : {}) });
  const activity: Activity = { observedRows: [{ table: "price", row: selected }, { table: "price", row: excluded }, { table: "price_set", row: set }],
    mutations: [], lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [
      queryRead("price", plan.rootQuery(), ["price-a157", "price-b157"], true),
      queryRead("price_set", commerceRelationReadQuery(defaultCommerceResources, plan.setPredicate(["pset157", "pset-historical157"])), ["pset157"]),
      queryRead("price", plan.rootQuery({ kind: "in", column: "price_set_id", values: ["pset157"] }), ["price-a157"], true),
      queryRead("price_set", commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
        { kind: "in", column: "id", values: ["pset157"] }, { kind: "isNull", column: "deleted_at" }] }), ["pset157"]),
      queryRead("price_list", commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
        { kind: "in", column: "id", values: ["plist-historical157"] }, { kind: "isNull", column: "deleted_at" }] }), []),
    ] };
  const call: Call = { commandName: "pricingListPricesForRemovalWorkflow", mode: "read", input, events: [],
    result: [{ ...selected, amount: 1, price_list_id: null, price_list: null, price_set: { id: "pset157" } }],
    fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
  return { call, activity };
}
beforeAll(async () => {
  contracts = Result.getOrThrow(compilePriceListPriceRemovalContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  policy = pricingPriceListPriceRemovalPolicy(contracts);
});

describe("Price List Price removal lifecycle contracts and receipts", () => {
  it("binds required active Set membership and nullable historical List presentation to actual selected reads", async () => {
    const { call, activity } = readCase();
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    const first = Array.isArray(call.result) ? call.result[0] : undefined;
    if (first === null || typeof first !== "object" || Array.isArray(first)) throw new Error("Missing read fixture result");
    await refused({ ...call, result: [{ ...first, price_list_id: "plist-historical157" }] }, activity);
    await refused({ ...call, result: [{ ...first, price_set: { id: "pset-historical157" } }] }, activity);
    await refused({ ...call, result: [{ ...first, title: "forged157" }] }, activity);
    await refused(call, { ...activity, relationalReads: activity.relationalReads.map((entry, index) => index === 2
      ? { ...entry, orderedIdentities: [{ id: "price-b157" }] } : entry) });
    await refused(call, { ...activity, relationalReads: activity.relationalReads.slice(0, 4) });
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: "price_set", row: { id: "outside157", ...managed } }] });
    await refused(call, { ...activity, observedRows: activity.observedRows.map(entry => entry.table === "price_set"
      ? { ...entry, row: { ...entry.row, deleted_at: stamp } } : entry) });
  });
  it("refuses read output invention when the complete Price query returns no identities", async () => {
    const { call } = readCase();
    const plan = Result.getOrThrow(contracts.compileNativeReadPlan(buildQuery({ id: ["missing157"] },
      { relations: ["price_list"], order: { id: "ASC" } })));
    const activity: Activity = { observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [],
      relationalReads: [{ table: "price", query: plan.rootQuery(), total: 0, returned: 0, orderedIdentities: [] }] };
    const empty: Call = { ...call, input: { filters: { id: ["missing157"] }, config: { relations: ["price_list"] } }, result: [] };
    await Effect.runPromise(policy.validateLogicalCall(empty, activity));
    await refused({ ...empty, result: call.result }, activity);
    await refused(empty, { ...activity, relationalReads: [] });
  });
  it("authenticates historical lookup evidence without returning predicate-excluded Set or List rows", async () => {
    const { call, activity } = readCase();
    const historical = [
      { table: "price_set", row: { id: "pset-historical157", ...managed, deleted_at: stamp } },
      { table: "price_list", row: { id: "plist-historical157", title: "Historical", description: "Retained",
        status: "draft", type: "sale", starts_at: null, ends_at: null, rules_count: 0, ...managed, deleted_at: stamp } },
    ];
    const evidence = { ...activity, observedRows: [...activity.observedRows, ...historical] };
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    for (const entry of historical) await refused(call, { ...evidence, observedRows: [
      ...evidence.observedRows, { ...entry, row: { ...entry.row, id: "unrelated-historical157" } },
    ] });
    await refused(call, { ...evidence, relationalReads: evidence.relationalReads.map((entry, index) => index === 1
      ? { ...entry, returned: 2, total: 2 } : entry) });
  });
  it("admits only the original lifecycle argument tuple, preserving raw empty and repeated selectors", () => {
    expect(Result.getOrThrow(decodePriceListPriceRemovalLifecycleArguments([["", "price-a157", "price-a157"]])))
      .toEqual([["", "price-a157", "price-a157"]]);
    for (const input of [[], ["price-a157"], [["price-a157"], {}], [["price-a157"], { returnLinkableKeys: ["price_id"] }],
      [Array.from({ length: 9 }, () => "price-a157")], [["x".repeat(257)]]])
      expect(Result.isFailure(decodePriceListPriceRemovalLifecycleArguments(input))).toBe(true);
  });
  it("validates complete internal tuples independently from public ID maps", () => {
    const roots = entries.filter(entry => entry.table === "price").map(entry => entry.row);
    const rules = entries.filter(entry => entry.table === "price_rule").map(entry => entry.row);
    expect(Result.getOrThrow(contracts.decodeLifecycleResult([roots, { Price: roots, PriceRule: rules }])))
      .toEqual([roots, { Price: roots, PriceRule: rules }]);
    const { raw_amount: _raw, ...incomplete } = roots[0]!;
    for (const tuple of [[roots, { Price: [...roots].reverse(), PriceRule: rules }],
      [[incomplete], { Price: [incomplete] }], [roots, { Price: roots, PriceList: [] }]])
      expect(Result.isFailure(contracts.decodeLifecycleResult(tuple))).toBe(true);
    expect(Result.getOrThrow(contracts.decodeOutput({ price_id: ["price-a157"], price_rule_id: ["rule-z157"] })))
      .toEqual({ price_id: ["price-a157"], price_rule_id: ["rule-z157"] });
    for (const output of [{ price_id: [roots[0]] }, { price_list_id: ["plist157"] }, { price_id: [""] },
      { price_id: Array.from({ length: 9 }, () => "price-a157") }])
      expect(Result.isFailure(contracts.decodeOutput(output))).toBe(true);
  });
  it("authenticates group order, parent traversal and mixed-history classification with TABLE+ID identities", async () => {
    const { call, activity } = valid();
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    await refused({ ...call, events: [...call.events.slice(0, 2), call.events[3]!, call.events[2]!] }, activity);
    await refused({ ...call, events: call.events.map((item, index) => index === 3 ? event("price_rule", "price-a157", "deleted") : item) }, activity);
    await refused(call, { ...activity, lifecycle: [...activity.lifecycle.slice(0, 2), activity.lifecycle[3]!, activity.lifecycle[2]!] });
    await refused({ ...call, result: { price_id: ["price-a157", "price-b157"], price_rule_id: ["price-a157", "rule-z157"] } }, activity);
  });
  it("refuses coalesced scalar events, forged complete rows, widened tables and incomplete graph reads", async () => {
    const { call, activity } = valid();
    await refused({ ...call, events: [event("price", ["price-a157", "price-b157"], "deleted"), ...call.events.slice(2)] }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.map((mutation, index) => index === 2
      ? { ...mutation, after: { ...mutation.after, value: "forged" } } : mutation) });
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "price_list", row: { id: "plist157" } }] });
    await refused(call, { ...activity, relationalReads: activity.relationalReads.slice(0, 2) });
    await refused(call, { ...activity, relationalReads: [...activity.relationalReads].reverse() });
    await refused(call, { ...activity, observedRows: activity.observedRows.map((entry, index) => index === 2
      ? { ...entry, row: { ...entry.row, price_id: "outside157" } } : entry) });
  });
  it("retains changed and active no-op restores without synthesizing module events or clock writes", async () => {
    for (const noop of [false, true]) {
      const { call, activity } = valid("restore", noop);
      await Effect.runPromise(policy.validateLogicalCall(call, activity));
      await refused({ ...call, events: [event("price", "price-a157", "updated")] }, activity);
      if (noop) await refused(call, { ...activity, lifecycle: activity.lifecycle.map((transition, index) => index === 0
        ? { ...transition, rowAtOperation: { ...transition.rowAtOperation, updated_at: next } } : transition) });
    }
  });
  it("authenticates empty and missing-root calls without fabricated results or lifecycle transitions", async () => {
    const activity: Activity = { observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [] };
    const call: Call = { commandName: "pricingPriceSoftDeleteForRemovalWorkflow", mode: "write", input: [], result: {}, events: [],
      fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [""] }, { ...activity, relationalReads: [read("price", "id", [""], 0)] }));
    await refused({ ...call, result: { price_id: ["invented157"] } }, activity);
    await refused({ ...call, events: [event("price", "invented157", "deleted")] }, activity);
  });
});
