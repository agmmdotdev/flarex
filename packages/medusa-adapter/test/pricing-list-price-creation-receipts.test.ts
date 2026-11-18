import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { buildPreNormalizationPriceConstraintsFromData } from "@medusajs/pricing/services";
import { defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compilePriceListPriceCreationContracts, type PriceListPriceCreationContracts } from "../src/modules/pricing/price-list-price-input";
import { pricingListPriceCreationPolicy } from "../src/modules/pricing/price-list-price-receipt";
import { encodeExactNumeric, ExactNumericRaw } from "../src/value/exact-numeric";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: PriceListPriceCreationContracts, policy: ReturnType<typeof pricingListPriceCreationPolicy>;
const numbers = new Map<number, { readonly value: string; readonly raw: typeof ExactNumericRaw.Type }>();
const decodeRaw = Schema.decodeUnknownSync(ExactNumericRaw);
const numeric = (amount: number) => {
  const value = numbers.get(amount); if (!value) throw new Error("Missing native exact numeric unit value"); return value;
};
const stamp = "2026-10-20T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const list: JsonObject = { id: "plist-unit155", title: "155", description: "", status: "draft", type: "sale", starts_at: null, ends_at: null, rules_count: 0, ...managed };
const set: JsonObject = { id: "pset-unit155", ...managed };
let price: JsonObject = { id: "price-unit155", title: null, currency_code: "USD", amount: "1", raw_amount: { value: "1", precision: 20 },
  min_quantity: null, raw_min_quantity: null, max_quantity: null, raw_max_quantity: null, rules_count: 1,
  price_set_id: "pset-unit155", price_list_id: "plist-unit155", ...managed };
const rule: JsonObject = { id: "prule-unit155", price_id: "price-unit155", attribute: "region155", value: "a", priority: 0, operator: "eq", ...managed };
const event = (object: string, action: string, id: Json): Json => ({ name: "pricing." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "pricing", object, action }, data: { id } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [] });
const read = (table: string, query: JsonObject, rows: readonly JsonObject[], identities = false): Activity["relationalReads"][number] => ({ table, query,
  total: rows.length, returned: rows.length, ...(identities ? { orderedIdentities: rows.map(row => ({ id: row.id! })) } : {}) });
const query = (column: string, values: string[], intrinsic = false): JsonObject => ({ take: defaultCommerceResources.queryRows,
  order: intrinsic ? { kind: "storageInsertion", direction: "asc" } : { column: "id", direction: "asc" }, predicate: { kind: "in", column, values } });
const rawPrice = { amount: 1, currency_code: "USD", price_set_id: "pset-unit155", rules: { region155: "a" } };
function fresh(): { call: Call; activity: Activity } {
  const plan = Result.getOrThrow(contracts.compileNativeCandidatePlan(buildQuery({ price_list_id: { $in: ["plist-unit155"] },
    currency_code: "USD", price_set_id: "pset-unit155" }, { relations: ["price_rules"], order: { id: "ASC" } })));
  const listPlan = Result.getOrThrow(contracts.listReadContracts.compileReadPlan({ filters: { id: ["plist-unit155"] }, config: {} }));
  const activity: Activity = { ...empty(), observedRows: [{ table: "price_list", row: list }, { table: "price_set", row: set },
    { table: "price", row: price }, { table: "price_rule", row: rule }],
  mutations: [{ ordinal: 0, table: "price", operation: "insert", before: null, after: price },
    { ordinal: 1, table: "price_rule", operation: "insert", before: null, after: rule }],
  relationalReads: [read("price_list", listPlan.rootQuery, [list], true), read("price_set", plan.setQuery, [set]),
    read("price", plan.rootQuery({ kind: "in", column: "price_set_id", values: ["pset-unit155"] }), [], true),
    read("price", query("id", ["price-unit155"]), []), read("price_set", query("id", ["pset-unit155"]), [set]),
    read("price_list", query("id", ["plist-unit155"]), [list]), read("price_rule", query("price_id", ["price-unit155"], true), [], true),
    read("price_rule", query("id", ["prule-unit155"], true), [], true), read("price_rule", query("price_id", ["price-unit155"], true), [rule], true)] };
  const call: Call = { commandName: "pricingAddPriceListPrices", mode: "write", input: [{ price_list_id: "plist-unit155", prices: [rawPrice] }],
    result: [{ amount: 1, currency_code: "USD", price_set_id: "pset-unit155", price_list_id: "plist-unit155", id: "price-unit155",
      raw_amount: numeric(1).raw, rules_count: 1, price_rules: [{ attribute: "region155", value: "a", priority: 0,
        id: "prule-unit155", price_id: "price-unit155" }] }], events: [event("price", "created", "price-unit155"), event("price_rule", "created", "prule-unit155")],
    fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 };
  return { call, activity };
}
function duplicateExisting(retained: JsonObject = rule): { call: Call; activity: Activity } {
  const scalar = (amount: number) => ({ amount, currency_code: "USD", min_quantity: null, max_quantity: null,
    price_set_id: "pset-unit155", price_list_id: "plist-unit155", id: "price-unit155", rules_count: 1,
    raw_amount: numeric(amount).raw, raw_min_quantity: null, raw_max_quantity: null });
  const plan = Result.getOrThrow(contracts.compileNativeCandidatePlan(buildQuery({ price_list_id: { $in: ["plist-unit155", "plist-unit155"] },
    currency_code: "USD", price_set_id: "pset-unit155", min_quantity: null, max_quantity: null },
  { relations: ["price_rules"], order: { id: "ASC" } })));
  const listPlan = Result.getOrThrow(contracts.listReadContracts.compileReadPlan({ filters: { id: ["plist-unit155", "plist-unit155"] }, config: {} }));
  const changed = { ...price, amount: numeric(77).value, raw_amount: numeric(77).raw };
  const activity: Activity = { ...empty(), observedRows: [{ table: "price_list", row: list }, { table: "price_set", row: set },
    { table: "price", row: changed }, { table: "price_rule", row: retained }],
  mutations: [{ ordinal: 0, table: "price", operation: "patch", before: price, after: changed },
    { ordinal: 1, table: "price_rule", operation: "patch", before: retained, after: retained }],
  relationalReads: [read("price_list", listPlan.rootQuery, [list], true), read("price_set", plan.setQuery, [set]),
    read("price", plan.rootQuery({ kind: "in", column: "price_set_id", values: ["pset-unit155"] }), [price], true),
    read("price_rule", plan.ruleQuery(["price-unit155"])!, [retained], true),
    read("price", query("id", ["price-unit155"]), [price]), read("price_set", query("id", ["pset-unit155"]), [set]),
    read("price_list", query("id", ["plist-unit155"]), [list]), read("price_rule", query("price_id", ["price-unit155"], true), [retained], true),
    read("price_rule", query("price_id", ["price-unit155"], true), [retained], true)] };
  const call: Call = { commandName: "pricingAddPriceListPrices", mode: "write",
    input: [77, 88].map(amount => ({ price_list_id: "plist-unit155", prices: [{ ...rawPrice, amount, min_quantity: null, max_quantity: null }] })),
    result: [{ ...scalar(77), price_rules: [retained] }, scalar(88)],
    events: [event("price", "updated", "price-unit155"), event("price_rule", "updated", "prule-unit155")],
    fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 };
  return { call, activity };
}
function interleaved(): { call: Call; activity: Activity } {
  const previous = duplicateExisting();
  const freshPrice = { ...price, id: "price-new155", currency_code: "CAD", amount: numeric(2).value, raw_amount: numeric(2).raw };
  const freshRule = { ...rule, id: "prule-new155", price_id: "price-new155", attribute: "region155", value: "b" };
  const sparseRule = { id: "prule-new155", price_id: "price-new155", attribute: "region155", value: "b", priority: 0 };
  const input = [77, 88].map(amount => ({ price_list_id: "plist-unit155", prices: [{ ...rawPrice, amount, min_quantity: null, max_quantity: null }] }));
  input.push({ price_list_id: "plist-unit155", prices: [{ ...rawPrice, currency_code: "CAD", amount: 2, min_quantity: null, max_quantity: null,
    rules: { region155: "b" } }] });
  const listIds = input.map(row => row.price_list_id);
  const envelope: unknown = Reflect.apply(buildQuery, undefined, [Reflect.apply(buildPreNormalizationPriceConstraintsFromData, undefined,
    [input.flatMap(row => row.prices), listIds]), { relations: ["price_rules"], order: { id: "ASC" } }]);
  const plan = Result.getOrThrow(contracts.compileNativeCandidatePlan(envelope));
  const listPlan = Result.getOrThrow(contracts.listReadContracts.compileReadPlan({ filters: { id: listIds }, config: {} }));
  const ruleQuery = plan.ruleQuery(["price-unit155"]); if (!ruleQuery) throw new Error("Missing nonempty candidate Rule query");
  if (!Array.isArray(previous.call.result)) throw new Error("Missing duplicate native response");
  const duplicate = previous.call.result[1]; if (!duplicate || typeof duplicate !== "object" || Array.isArray(duplicate)) throw new Error("Missing duplicate sparse Price");
  const call: Call = { ...previous.call, input, toAttempt: 4,
    result: [previous.call.result[0]!, { ...duplicate, price_rules: [sparseRule] },
      { id: "price-new155", amount: 2, raw_amount: numeric(2).raw, currency_code: "CAD", price_set_id: "pset-unit155", price_list_id: "plist-unit155",
        min_quantity: null, raw_min_quantity: null, max_quantity: null, raw_max_quantity: null, rules_count: 1 }],
    events: [event("price", "created", "price-new155"), event("price_rule", "created", "prule-new155"), ...previous.call.events] };
  const activity: Activity = { ...previous.activity, observedRows: [...previous.activity.observedRows, { table: "price", row: freshPrice }, { table: "price_rule", row: freshRule }],
    mutations: [{ ordinal: 0, table: "price", operation: "insert", before: null, after: freshPrice },
      { ordinal: 1, table: "price_rule", operation: "insert", before: null, after: freshRule },
      ...previous.activity.mutations.map((change, index) => ({ ...change, ordinal: index + 2 }))],
    relationalReads: [read("price_list", listPlan.rootQuery, [list], true), read("price_set", plan.setQuery, [set]),
      read("price", plan.rootQuery({ kind: "in", column: "price_set_id", values: ["pset-unit155"] }), [price], true), read("price_rule", ruleQuery, [rule], true),
      read("price", query("id", ["price-unit155"]), [price]), read("price_set", query("id", ["pset-unit155"]), [set]),
      read("price_list", query("id", ["plist-unit155"]), [list]), read("price_rule", query("price_id", ["price-unit155"], true), [rule], true),
      read("price", query("id", ["price-new155"]), []), read("price_rule", query("price_id", ["price-new155"], true), [], true),
      read("price_rule", query("id", ["prule-new155"], true), [], true),
      read("price_rule", query("price_id", ["price-new155", "price-unit155"], true), [rule, freshRule], true)] };
  return { call, activity };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
beforeAll(async () => {
  for (const amount of [1, 2, 77, 88]) {
    const encoded = await Effect.runPromise(encodeExactNumeric(amount));
    numbers.set(amount, { value: encoded.value, raw: { ...decodeRaw(encoded.raw) } });
  }
  price = { ...price, amount: numeric(1).value, raw_amount: numeric(1).raw };
  contracts = Result.getOrThrow(compilePriceListPriceCreationContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  policy = pricingListPriceCreationPolicy(contracts);
});

describe("native Price List Price creation receipts", () => {
  it("binds sparse output, complete rows, native exact numbers and scalar event multiplicity", async () => {
    const { call, activity } = fresh(); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    await refused({ ...call, events: [event("price", "created", ["price-unit155"]), call.events[1]!] }, activity);
    await refused({ ...call, events: [...call.events, event("price", "created", "outside155")] }, activity);
    await refused({ ...call, events: call.events.slice(1) }, activity);
  });
  it("rejects output inventions, omitted native fields and forged exact numeric companions", async () => {
    const { call, activity } = fresh();
    const value = Array.isArray(call.result) ? call.result[0] : undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing checked unit Price DTO");
    const { rules_count: _count, ...missing } = value;
    await refused({ ...call, result: [missing] }, activity);
    await refused({ ...call, result: [{ ...value, title: null }] }, activity);
    await refused({ ...call, result: [{ ...value, amount: 2 }] }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.map(change => change.table === "price" ?
      { ...change, after: { ...price, raw_amount: numeric(2).raw } } : change) });
  });
  it("rejects cross-owner mutations, foreign target reads and synthetic existing identities", async () => {
    const { call, activity } = fresh();
    await refused(call, { ...activity, mutations: activity.mutations.map(change => change.table === "price_rule" ?
      { ...change, after: { ...rule, price_id: "outside155" } } : change) });
    await refused(call, { ...activity, relationalReads: [...activity.relationalReads, { table: "price", total: 0, returned: 0,
      query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: ["outside155"] } } }] });
    await refused(call, { ...activity, mutations: activity.mutations.map(change => change.table === "price" ?
      { ...change, operation: "patch", before: { ...price, deleted_at: stamp } } : change) });
  });
  it("requires the complete authenticated native candidate read rather than a fabricated empty selection", async () => {
    const { call, activity } = fresh();
    await refused(call, { ...activity, relationalReads: activity.relationalReads.slice(0, 2) });
    await refused(call, { ...activity, relationalReads: activity.relationalReads.map((row, index) => index === 2 ?
      { ...row, orderedIdentities: [{ id: "outside155" }], total: 1, returned: 1 } : row) });
    await refused(call, { ...activity, relationalReads: [...activity.relationalReads, activity.relationalReads[2]!] });
  });
  it("retains duplicate sparse positions while binding first scalar writes and equal Rule upsert attempts", async () => {
    const { call, activity } = duplicateExisting();
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, mutations: activity.mutations.slice(0, 1) });
    await refused(call, { ...activity, mutations: activity.mutations.map(change => change.table === "price" ?
      { ...change, after: { ...price, amount: numeric(88).value, raw_amount: numeric(88).raw } } : change) });
    await refused({ ...call, events: [...call.events, event("price", "updated", "price-unit155")] }, activity);
    if (!Array.isArray(call.result)) throw new Error("Missing duplicate sparse DTOs");
    await refused({ ...call, result: [...call.result].reverse() }, activity);
  });
  it("refuses invented retained Rule managed values, foreign owners and changed managed clocks", async () => {
    const { call, activity } = duplicateExisting();
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    for (const field of ["created_at", "updated_at", "deleted_at"]) {
      await refused(call, { ...activity, mutations: activity.mutations.map(change => change.table === "price_rule" ?
        { ...change, after: { ...rule, [field]: "2026-10-21T00:00:00.000Z" } } : change) });
    }
    await refused(call, { ...activity, mutations: activity.mutations.map(change => change.table === "price_rule" ?
      { ...change, before: { ...rule, price_id: "outside155" } } : change) });
    if (!Array.isArray(call.result)) throw new Error("Missing checked retained output");
    const first = call.result[0];
    if (first === null || typeof first !== "object" || Array.isArray(first)) throw new Error("Missing checked retained Price");
    await refused({ ...call, result: [{ ...first, price_rules: [{ ...rule, created_at: "2026-10-21T00:00:00.000Z" }] }, call.result[1]!] }, activity);
  });
  it("preserves native retained operator and finite priority while rejecting invented Rule preimages", async () => {
    const retained = { ...rule, operator: "gte", priority: -1.25 };
    const { call, activity } = duplicateExisting(retained);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, mutations: activity.mutations.map(change => change.table === "price_rule" ?
      { ...change, after: { ...retained, operator: "eq" } } : change) });
    const invented = { ...retained, operator: "lte", priority: 2.5 };
    await refused(call, { ...activity, mutations: activity.mutations.map(change => change.table === "price_rule" ?
      { ...change, before: invented, after: invented } : change) });
  });
  it("preserves native duplicate-position relation reconstruction while enforcing actual stored owners", async () => {
    const { call, activity } = interleaved();
    expect(Result.isSuccess(contracts.decodeOutput(call.result))).toBe(true);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    if (!Array.isArray(call.result)) throw new Error("Missing native interleaved response");
    const duplicate = call.result[1]; if (!duplicate || typeof duplicate !== "object" || Array.isArray(duplicate)) throw new Error("Missing duplicate response position");
    const fresh = call.result[2]; if (!fresh || typeof fresh !== "object" || Array.isArray(fresh)) throw new Error("Missing fresh response position");
    const { price_rules: rules, ...withoutRules } = duplicate;
    await refused({ ...call, result: [call.result[0]!, withoutRules, { ...fresh, price_rules: rules! }] }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.map(change => change.after?.id === "prule-new155" ?
      { ...change, after: { ...change.after, price_id: "price-unit155" } } : change) });
    const finalRead = activity.relationalReads.at(-1); if (!finalRead) throw new Error("Missing complete native relation refresh");
    if (!isJsonObject(finalRead.query)) throw new Error("Missing canonical native relation query");
    for (const values of [["price-unit155", "price-new155"], ["price-new155"], ["price-new155", "price-unit155", "outside155"],
      ["price-new155", "outside155"], ["price-new155", 1]]) {
      await refused(call, { ...activity, relationalReads: [...activity.relationalReads.slice(0, -1), { ...finalRead,
        query: { ...finalRead.query, predicate: { kind: "in", column: "price_id", values } } }] });
    }
  });
  it("authenticates full historical inverse closure and only actual Price deletion events", async () => {
    const children = [{ ...rule, id: "prule-history155", attribute: "historical155", deleted_at: stamp }, rule];
    const activity: Activity = { ...empty(), observedRows: [], mutations: [...children.map(row => ({ table: "price_rule", operation: "delete" as const, before: row, after: null })),
      { table: "price", operation: "delete" as const, before: price, after: null }].map((change, ordinal) => ({ ...change, ordinal })),
    relationalReads: [{ table: "price_rule", query: { take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
      predicate: { kind: "in", column: "price_id", values: ["price-unit155", "price-unit155"] } }, total: 2, returned: 2 },
      read("price", query("id", ["price-unit155"], true), [price], true)] };
    const call: Call = { commandName: "pricingRemovePriceListPrices", mode: "write", input: ["price-unit155", "price-unit155"], result: null,
      events: [event("price", "deleted", "price-unit155")], fromAttempt: 0, toAttempt: 3, fromLifecycle: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [], events: [], toAttempt: 0 }, empty()));
    await refused({ ...call, input: [], events: [], toAttempt: 0 }, activity);
    await refused({ ...call, events: [...call.events, event("price_rule", "deleted", "prule-history155")] }, activity);
    await refused({ ...call, events: [...call.events, event("price", "deleted", "price-unit155")] }, activity);
    await refused(call, { ...activity, mutations: [...activity.mutations,
      { ordinal: 3, table: "price", operation: "delete", before: price, after: null }] });
    await refused(call, { ...activity, mutations: activity.mutations.filter(change => change.before?.id !== "prule-history155").map((change, ordinal) => ({ ...change, ordinal })) });
    await refused({ ...call, input: ["outside155"] }, activity);
  });
  it("binds the named portable inverse cohort order independently of reversed duplicate raw selectors", async () => {
    const other = { ...price, id: "price-other155" }, otherRule = { ...rule, id: "prule-other155", price_id: "price-other155" };
    const ids = ["price-other155", "price-unit155", "price-unit155"];
    const activity: Activity = { ...empty(), mutations: [
      { ordinal: 0, table: "price_rule", operation: "delete", before: otherRule, after: null },
      { ordinal: 1, table: "price_rule", operation: "delete", before: rule, after: null },
      { ordinal: 2, table: "price", operation: "delete", before: price, after: null },
      { ordinal: 3, table: "price", operation: "delete", before: other, after: null },
    ], relationalReads: [read("price_rule", query("price_id", ids), [otherRule, rule]),
      read("price", query("id", [...new Set(ids)], true), [price, other], true)] };
    const call: Call = { commandName: "pricingRemovePriceListPrices", mode: "write", input: ids, result: null,
      events: [event("price", "deleted", "price-unit155"), event("price", "deleted", "price-other155")],
      fromAttempt: 0, toAttempt: 4, fromLifecycle: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, relationalReads: [activity.relationalReads[0]!,
      read("price", query("id", [...new Set(ids)], true), [other, price], true)] });
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    await refused({ ...call, events: [...call.events].reverse() }, { ...activity, mutations: [
      ...activity.mutations.slice(0, 2), { ordinal: 2, table: "price", operation: "delete", before: other, after: null },
      { ordinal: 3, table: "price", operation: "delete", before: price, after: null },
    ] });
    await refused(call, { ...activity, relationalReads: activity.relationalReads.slice(0, 1) });
  });
});
