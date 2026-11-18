import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { buildPreNormalizationPriceConstraintsFromData } from "@medusajs/pricing/services";
import { normalizePrices } from "@medusajs/pricing/normalization";
import { applyUpsertRelationResults } from "@medusajs/utils/dal/upsert-planning";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compilePriceListPriceUpdateContracts, type PriceListPriceUpdateContracts } from "../src/modules/pricing/price-list-price-update-input";
import { pricingListPriceUpdatePolicy } from "../src/modules/pricing/price-list-price-update-receipt";
import { planPriceListPriceWrite } from "../src/modules/pricing/price-list-price-repository";
import { encodeExactNumeric, projectExactNumericColumns } from "../src/value/exact-numeric";
import { captureCommerceInput } from "../src/value/input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Row = JsonObject & Readonly<{ id: string }>;
let contracts: PriceListPriceUpdateContracts, policy: ReturnType<typeof pricingListPriceUpdatePolicy>;
const amounts = new Map<number, { readonly value: string; readonly raw: JsonObject }>();
const numeric = (amount: number) => {
  const encoded = amounts.get(amount);
  if (encoded === undefined) throw new Error("Missing actual encoded unit amount");
  return encoded;
};
const stamp = "2026-10-20T00:00:00.000Z", history = "2026-10-19T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const list: Row = { id: "plist-receipt156", title: "156", description: "", status: "draft", type: "sale",
  starts_at: null, ends_at: null, rules_count: 0, ...managed };
const set: Row = { id: "pset-receipt156", ...managed };
const price = (amount = 40): Row => ({ id: "price-receipt156", title: null, currency_code: "USD",
  amount: numeric(amount).value, raw_amount: numeric(amount).raw, min_quantity: null, raw_min_quantity: null,
  max_quantity: null, raw_max_quantity: null, rules_count: 2, price_set_id: set.id, price_list_id: list.id, ...managed });
const oldRules = (): Row[] => [
  { id: "rule-active156", price_id: "price-receipt156", attribute: "region156", value: "a", operator: "gt", priority: -1.5, ...managed },
  { id: "rule-history156", price_id: "price-receipt156", attribute: "region156", value: "b", operator: "lt", priority: 2.5, ...managed, deleted_at: history },
];
const event = (object: string, action: string, id: string): Json => ({ name: "pricing." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "pricing", object, action }, data: { id } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [] });
const read = (table: string, query: JsonObject, rows: readonly Row[]): Activity["relationalReads"][number] => ({
  table, query, total: rows.length, returned: rows.length, orderedIdentities: rows.map(row => ({ id: row.id })),
});
const query = (column: string, values: readonly string[], intrinsic = false): JsonObject => ({ take: defaultCommerceResources.queryRows,
  order: intrinsic ? { kind: "storageInsertion", direction: "asc" } : { column: "id", direction: "asc" },
  predicate: { kind: "in", column, values: [...values] } });
const call = (commandName: string, mode: Call["mode"], input: Json, result: Json, events: readonly Json[] = [], attempts = 0): Call => ({
  commandName, mode, input, result, events, fromAttempt: 0, toAttempt: attempts, fromLifecycle: 0, toLifecycle: 0,
});

function snapshot() {
  const root = price(), rules = oldRules();
  const input = [{ price_list_id: list.id, prices: [{ id: root.id, price_set_id: set.id, currency_code: "USD", amount: 77,
    min_quantity: null, max_quantity: null }] }];
  const nativeWhere: unknown = Reflect.apply(buildPreNormalizationPriceConstraintsFromData, undefined,
    [input.flatMap(entry => entry.prices), input.map(entry => entry.price_list_id)]);
  const nativeQuery: unknown = Reflect.apply(buildQuery, undefined,
    [{ $or: [nativeWhere, { id: [root.id] }] }, { withDeleted: true, order: { id: "ASC" } }]);
  const plan = Result.getOrThrow(contracts.compilePriceReadPlan(nativeQuery));
  const nativeRules: unknown = Reflect.apply(buildQuery, undefined,
    [{ price_id: [root.id] }, { withDeleted: true, order: { id: "ASC" } }]);
  const ruleQuery = Result.getOrThrow(contracts.compileRuleReadPlan(nativeRules));
  const output = { prices: [{ ...root, amount: 40, price_rules: rules }] };
  const activity: Activity = { ...empty(), observedRows: [{ table: "price", row: root }, ...rules.map(row => ({ table: "price_rule", row }))],
    relationalReads: [read("price", plan.rootQuery, [root]), read("price_rule", ruleQuery, rules)] };
  return { root, rules, output, call: call("pricingListPriceSnapshot", "read", input, output), activity };
}

function restore() {
  const retained = price(), current = price(77), rules = oldRules();
  const fresh: Row = { ...price(55), id: "price-new156", currency_code: "CAD", rules_count: 1 };
  const freshRule: Row = { ...rules[0], id: "rule-new156", price_id: fresh.id, attribute: "fresh156" };
  const replacement: Row = { ...rules[0], id: "rule-replacement156", attribute: "replacement156" };
  const before = [{ ...retained, amount: 40, price_rules: rules }];
  const compensation = { before, createdPriceIds: [fresh.id] };
  const activity: Activity = { ...empty(), observedRows: [
    { table: "price_list", row: list }, { table: "price_set", row: set }, { table: "price", row: current },
    { table: "price", row: fresh }, { table: "price_rule", row: freshRule }, { table: "price_rule", row: replacement },
  ], mutations: [
    { ordinal: 0, table: "price_rule", operation: "delete", before: freshRule, after: null },
    { ordinal: 1, table: "price", operation: "delete", before: fresh, after: null },
    { ordinal: 2, table: "price_rule", operation: "delete", before: replacement, after: null },
    ...rules.map((row, index) => ({ ordinal: index + 3, table: "price_rule", operation: "insert" as const, before: null, after: row })),
    { ordinal: 5, table: "price", operation: "replace", before: current, after: retained },
  ], relationalReads: [
    read("price_rule", query("price_id", [fresh.id]), [freshRule]), read("price", query("id", [fresh.id], true), [fresh]),
    read("price", query("id", [retained.id]), [current]), read("price_set", query("id", [set.id]), [set]),
    read("price_list", query("id", [list.id]), [list]), read("price_rule", query("price_id", [retained.id], true), [replacement]),
    ...rules.map(row => read("price_rule", query("id", [row.id], true), [])),
    read("price_rule", query("id", [replacement.id], true), [replacement]),
    read("price_rule", query("price_id", [retained.id], true), rules),
  ] };
  const events = [event("price", "deleted", fresh.id), ...rules.map(row => event("price_rule", "created", row.id)),
    event("price", "updated", retained.id), event("price_rule", "deleted", replacement.id)];
  return { retained, current, rules, fresh, freshRule, replacement, compensation,
    call: call("pricingListPriceRestore", "write", compensation, null, events, activity.mutations.length), activity };
}

async function forward() {
  const root = price(), rules: Row[] = [
    { id: "rule-z-first156", price_id: root.id, attribute: "first156", value: "one", operator: "eq", priority: 0, ...managed },
    { id: "rule-a-second156", price_id: root.id, attribute: "second156", value: "two", operator: "eq", priority: 1, ...managed },
  ];
  const supplied = { price_set_id: set.id, currency_code: "USD", amount: 77,
    min_quantity: null, max_quantity: null, rules: { first156: "one", second156: "two" } };
  const input = [{ price_list_id: list.id, prices: [supplied] }];
  const nativeWhere: unknown = Reflect.apply(buildPreNormalizationPriceConstraintsFromData, undefined,
    [input.flatMap(entry => entry.prices), [list.id]]);
  const nativeQuery: unknown = Reflect.apply(buildQuery, undefined,
    [nativeWhere, { relations: ["price_rules"], order: { id: "ASC" } }]);
  const plan = Result.getOrThrow(contracts.compilePriceReadPlan(nativeQuery)), ruleQuery = plan.ruleQuery([root.id]);
  if (ruleQuery === undefined) throw new Error("Missing nonempty candidate Rule query");
  const listPlan = Result.getOrThrow(contracts.listReadContracts.compileReadPlan({ filters: { id: [list.id] }, config: {} }));
  const normalized: unknown = Reflect.apply(normalizePrices, undefined,
    [structuredClone([supplied]), [{ ...root, amount: 40, price_rules: structuredClone(rules) }], list.id]);
  const staged = await Effect.runPromise(planPriceListPriceWrite(contracts, normalized, { relations: ["price_rules"] }, defaultCommerceResources,
    supplied => supplied === root.id ? Result.succeed(supplied) : Result.fail(commerceError("receiptMismatch")),
    supplied => supplied !== undefined && rules.some(row => row.id === supplied)
      ? Result.succeed(supplied) : Result.fail(commerceError("receiptMismatch")), "update"));
  const scalar = staged.unique[0];
  if (staged.unique.length !== 1 || scalar === undefined) throw new Error("Expected one actual normalized existing root");
  const changed: Row = { ...root, ...scalar, id: scalar.id };
  applyUpsertRelationResults(staged.batch.reconstructedResponse, "price_rules", staged.relationResults);
  const response = Result.getOrThrow(captureCommerceInput(staged.batch.reconstructedResponse));
  const output = Result.getOrThrow(contracts.decodeOutput(await Effect.runPromise(projectExactNumericColumns(response, staged.numeric, "reserialize"))));
  const activity: Activity = { ...empty(), observedRows: [{ table: "price_list", row: list }, { table: "price_set", row: set },
    { table: "price", row: changed }, ...[...rules].reverse().map(row => ({ table: "price_rule", row }))], mutations: [
    { ordinal: 0, table: "price", operation: "patch", before: root, after: changed },
    ...rules.map((row, index) => ({ ordinal: index + 1, table: "price_rule", operation: "patch" as const, before: row, after: row })),
  ], relationalReads: [
    read("price_list", listPlan.rootQuery, [list]), read("price", plan.rootQuery, [root]), read("price_rule", ruleQuery, rules),
    read("price", query("id", [root.id]), [root]), read("price_set", query("id", [set.id]), [set]),
    read("price_list", query("id", [list.id]), [list]), read("price_rule", query("price_id", [root.id], true), rules),
    read("price_rule", query("price_id", [root.id], true), rules),
  ] };
  return { rules, output, candidateRead: 2, call: call("pricingListPriceUpdate", "write", input, output,
    [event("price", "updated", root.id), ...rules.map(row => event("price_rule", "updated", row.id))], activity.mutations.length), activity };
}

const accepted = (value: { call: Call; activity: Activity }) => Effect.runPromise(policy.validateLogicalCall(value.call, value.activity));
const refused = async (observed: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(observed, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  for (const value of [40, 55, 77]) {
    const encoded = await Effect.runPromise(encodeExactNumeric(value));
    const raw = Result.getOrThrow(captureCommerceInput(encoded.raw));
    if (!isJsonObject(raw)) throw new Error("Expected the native numeric raw companion object");
    amounts.set(value, { value: encoded.value, raw });
  }
  contracts = Result.getOrThrow(compilePriceListPriceUpdateContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  policy = pricingListPriceUpdatePolicy(contracts);
});

describe("complete Price List Price update snapshot and restore receipts", () => {
  it("requires the complete protected candidate Rule order before native forward normalization", async () => {
    const value = await forward(); await accepted(value);
    expect(value.output.map(row => row.id)).toEqual(["price-receipt156"]);
    expect(value.output.map(row => row.amount)).toEqual([77]);
    expect(value.rules.map(row => row.id)).toEqual(["rule-z-first156", "rule-a-second156"]);
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.map((row, index) => {
      if (index !== value.candidateRead) return row;
      const { orderedIdentities: _identities, ...unproved } = row; return unproved;
    }) });
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.map((row, index) => index === value.candidateRead
      ? { ...row, orderedIdentities: value.rules.map(() => ({ id: "rule-z-first156" })) } : row) });
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.map((row, index) => index === value.candidateRead
      ? { ...row, orderedIdentities: value.rules.map((rule, position) => ({ id: position === 0 ? "rule-foreign156" : rule.id })) } : row) });
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.map((row, index) => index === value.candidateRead
      ? { ...row, orderedIdentities: [...value.rules].reverse().map(rule => ({ id: rule.id })) } : row) });
  });

  it("binds complete active and historical Rule snapshots to the actual ordered reads", async () => {
    const value = snapshot(); await accepted(value);
    expect(value.rules.some(row => row.deleted_at !== null)).toBe(true);
    await refused({ ...value.call, result: { prices: [{ ...value.root, amount: 40, price_rules: value.rules.filter(row => row.deleted_at === null) }] } }, value.activity);
    await refused({ ...value.call, result: { prices: [{ ...value.root, amount: 40,
      price_rules: value.rules.map(row => ({ ...row, deleted_at: null })) }] } }, value.activity);
  });

  it("rejects snapshot clocks and raw companions that differ from stored complete rows", async () => {
    const value = snapshot(); await accepted(value);
    for (const field of ["created_at", "updated_at", "deleted_at"])
      await refused({ ...value.call, result: { prices: [{ ...value.output.prices[0], [field]: "2080-01-01T00:00:00.000Z" }] } }, value.activity);
    await refused({ ...value.call, result: { prices: [{ ...value.output.prices[0], raw_amount: numeric(77).raw }] } }, value.activity);
    await refused({ ...value.call, result: { prices: [{ ...value.output.prices[0], price_rules: value.rules.map(row =>
      row.deleted_at === null ? row : { ...row, updated_at: "2080-01-01T00:00:00.000Z" }) }] } }, value.activity);
  });

  it("requires complete snapshot read identities and the exact native query scope", async () => {
    const value = snapshot(); await accepted(value);
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.slice(0, 1) });
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.map((row, index) => index === 1
      ? { ...row, orderedIdentities: value.rules.map((rule, position) => ({ id: position === 0 ? "rule-foreign156" : rule.id })) } : row) });
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.map((row, index) => index === 0
      ? { ...row, query: query("id", ["price-foreign156"]) } : row) });
  });

  it("rejects writes and events in a successful snapshot receipt", async () => {
    const value = snapshot(); await accepted(value);
    await refused(value.call, { ...value.activity, mutations: [{ ordinal: 0, table: "price", operation: "patch", before: value.root, after: value.root }] });
    await refused({ ...value.call, events: [event("price", "updated", value.root.id)] }, value.activity);
  });

  it("binds mixed inverse deletion and exact full-graph replay with historical Rule identities", async () => {
    const value = restore(); await accepted(value);
    expect(Result.isSuccess(contracts.decodeCompensation(value.compensation))).toBe(true);
    expect(value.rules.map(row => row.operator)).toEqual(["gt", "lt"]);
    expect(value.rules.map(row => row.priority)).toEqual([-1.5, 2.5]);
    await refused({ ...value.call, input: { ...value.compensation, before: value.compensation.before.map(row =>
      ({ ...row, price_rules: row.price_rules.filter(rule => rule.deleted_at === null) })) } }, value.activity);
    await refused(value.call, { ...value.activity, mutations: value.activity.mutations.filter(change => change.after?.id !== "rule-history156")
      .map((change, ordinal) => ({ ...change, ordinal })) });
  });

  it("compares actual replay clocks and raw companions against retained complete data", async () => {
    const value = restore(); await accepted(value);
    for (const field of ["created_at", "updated_at", "deleted_at"]) {
      await refused(value.call, { ...value.activity, mutations: value.activity.mutations.map(change => change.operation === "replace"
        ? { ...change, after: { ...value.retained, [field]: "2080-01-01T00:00:00.000Z" } } : change) });
      await refused({ ...value.call, input: { ...value.compensation, before: value.compensation.before.map(row =>
        ({ ...row, [field]: "2080-01-01T00:00:00.000Z" })) } }, value.activity);
    }
    await refused(value.call, { ...value.activity, mutations: value.activity.mutations.map(change => change.operation === "replace"
      ? { ...change, after: { ...value.retained, raw_amount: numeric(77).raw } } : change) });
    await refused({ ...value.call, input: { ...value.compensation, before: value.compensation.before.map(row =>
      ({ ...row, raw_amount: numeric(77).raw })) } }, value.activity);
    await refused(value.call, { ...value.activity, mutations: value.activity.mutations.map(change => change.after?.id === "rule-history156"
      ? { ...change, after: { ...change.after, deleted_at: null } } : change) });
  });

  it("rejects missing, foreign and unproved inverse read cohorts", async () => {
    const value = restore(); await accepted(value);
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.slice(1) });
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.map((row, index) => index === 1
      ? { ...row, orderedIdentities: [{ id: "price-foreign156" }] } : row) });
    await refused(value.call, { ...value.activity, relationalReads: value.activity.relationalReads.map((row, index) => index === 5
      ? { ...row, query: query("price_id", ["price-foreign156"], true) } : row) });
    await refused(value.call, { ...value.activity, relationalReads: [...value.activity.relationalReads,
      read("price", query("id", ["price-foreign156"]), [])] });
  });

  it("rejects extra replay mutations, cascade events and altered event multiplicity", async () => {
    const value = restore(); await accepted(value);
    await refused(value.call, { ...value.activity, mutations: [...value.activity.mutations,
      { ordinal: value.activity.mutations.length, table: "price", operation: "replace", before: value.current, after: value.retained }] });
    await refused({ ...value.call, events: [...value.call.events, event("price_rule", "deleted", value.freshRule.id)] }, value.activity);
    await refused({ ...value.call, events: [...value.call.events].reverse() }, value.activity);
    await refused({ ...value.call, events: value.call.events.slice(1) }, value.activity);
  });

  it("keeps empty snapshot and inverse routes empty and rejects unknown commands", async () => {
    await accepted({ call: call("pricingListPriceSnapshot", "read", [], { prices: [] }), activity: empty() });
    await accepted({ call: call("pricingListPriceRestore", "write", { before: [], createdPriceIds: [] }, null), activity: empty() });
    await refused(call("pricingListPriceRestore", "write", { before: [], createdPriceIds: [] }, null,
      [event("price", "updated", "price-foreign156")]), empty());
    await refused(call("pricingAddPriceListPrices", "write", [], null), empty());
  });
});
