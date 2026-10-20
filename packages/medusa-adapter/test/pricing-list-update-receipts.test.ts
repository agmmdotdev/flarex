import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { validateRelationalRowValues } from "flarex-protocol/internal/relational-schema";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata, compilePricingDefinition } from "../src/modules/pricing/schema";
import { compilePriceListUpdateContracts, type PriceListUpdateContracts } from "../src/modules/pricing/list-update-input";
import { pricingListUpdatePolicy } from "../src/modules/pricing/list-update-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { priceListUpdateComparisonRows } from "./support/logical-price-list-update-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: PriceListUpdateContracts, policy: ReturnType<typeof pricingListUpdatePolicy>;
const stamp = "2026-01-01T00:00:00.000Z", childStamp = "2026-10-20T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const root: JsonObject = { id: "plist-unit153", title: "before153", description: "", status: "draft", type: "sale",
  starts_at: null, ends_at: null, rules_count: 2, ...managed };
const oldRules: JsonObject[] = [
  { id: "plrule-unit153-z", price_list_id: root.id!, attribute: "region_id", value: ["old153"], ...managed },
  { id: "plrule-unit153-a", price_list_id: root.id!, attribute: "second153", value: ["old153"], ...managed },
  { id: "plrule-unit153-history", price_list_id: root.id!, attribute: "history153", value: ["history"], ...managed, deleted_at: stamp },
];
const newRules: JsonObject[] = [
  { id: "plrule-unit153-new-z", price_list_id: root.id!, attribute: "region_id", value: ["new153"], ...managed, created_at: childStamp, updated_at: childStamp },
  { id: "plrule-unit153-new-a", price_list_id: root.id!, attribute: "", value: ["", ""], ...managed, created_at: childStamp, updated_at: childStamp },
];
const after: JsonObject = { ...root, title: "after153" };
const childDto = (row: JsonObject): JsonObject => ({ id: row.id!, price_list_id: row.price_list_id!, attribute: row.attribute!, value: row.value! });
const event = (object: string, action: string, id: Json): Json => ({ name: "pricing." + object.replaceAll("_", "-") + "." + action,
  metadata: { source: "pricing", object, action }, data: { id } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const query = (column: string, values: Json[], intrinsic = false) => commerceRelationReadQuery(defaultCommerceResources,
  { kind: "in", column, values }, intrinsic ? { kind: "storageInsertion", direction: "asc" } : "id");
const read = (table: string, query: JsonObject, rows: readonly JsonObject[], identities = false): Activity["relationalReads"][number] => ({ table, query,
  total: rows.length, returned: rows.length, ...(identities ? { orderedIdentities: rows.map(row => ({ id: row.id! })) } : {}) });
const preRead = (ids: string[], rows: readonly JsonObject[]) => read("price_list", Result.getOrThrow(contracts.compileReadPlan({ filters: { id: ids }, config: {} })).rootQuery, rows, true);
const activity = (): Activity => ({ ...empty(), observedRows: [{ table: "price_list", row: root },
  ...[...oldRules, ...newRules].map(row => ({ table: "price_list_rule", row }))],
  mutations: [
    ...oldRules.map(row => ({ table: "price_list_rule", operation: "delete" as const, before: row, after: null })),
    ...newRules.map(row => ({ table: "price_list_rule", operation: "insert" as const, before: null, after: row })),
    { table: "price_list", operation: "patch" as const, before: root, after },
  ].map((change, ordinal) => ({ ...change, ordinal })),
  relationalReads: [preRead([String(root.id)], [root]), read("price_list", query("id", [root.id!]), [root]),
    read("price_list_rule", query("price_list_id", [root.id!], true), oldRules, true),
    ...newRules.map(row => read("price_list_rule", query("id", [row.id!], true), [], true)),
    read("price_list_rule", query("id", oldRules.map(row => row.id!), true), oldRules, true),
    read("price_list_rule", query("price_list_id", [root.id!], true), newRules, true)],
});
const call = (observed: Activity): Call => ({ commandName: "pricingListUpdate", mode: "write",
  input: [{ id: root.id!, title: "after153", rules: { region_id: ["new153"], "": ["", ""] } }],
  result: [{ id: root.id!, title: "after153", rules_count: 2, price_list_rules: newRules.map(childDto) }],
  events: [...newRules.map(row => event("price_list_rule", "created", row.id!)), event("price_list", "updated", root.id!), ...oldRules.map(row => event("price_list_rule", "deleted", row.id!))],
  fromAttempt: 0, toAttempt: observed.mutations.length, fromLifecycle: 0, toLifecycle: 0 });
const refused = async (request: Call, observed: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(request, observed))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => { contracts = Result.getOrThrow(compilePriceListUpdateContracts((await Effect.runPromise(capturePricingMetadata())).frame)); policy = pricingListUpdatePolicy(contracts); });

describe("native Price List update receipts", () => {
  it("validates every canonical comparison row through the actual relational schema", async () => {
    const definition = await Effect.runPromise(compilePricingDefinition());
    for (const entry of priceListUpdateComparisonRows().seedRows) {
      const table = definition.schema.tables.find(table => table.identity.tableId === entry.table);
      if (!table) throw new Error("Unknown comparison table " + entry.table);
      await Effect.runPromise(Effect.fromResult(validateRelationalRowValues(table, entry.row)).pipe(Effect.mapError(cause => new Error(
        "Invalid Price List update seed " + entry.table + "/" + entry.row.id, { cause }))));
    }
  });

  it("binds sparse active preimages to actual root and child identities while excluding historical members", async () => {
    const input = { filters: { id: [String(root.id)] }, config: { select: ["id", "price_list_rules.value", "price_list_rules.attribute"], relations: ["price_list_rules"] } };
    const plan = Result.getOrThrow(contracts.compileReadPlan(input)), ruleQuery = plan.ruleQuery([String(root.id)]);
    if (!ruleQuery) throw new Error("Missing genuine child projection query");
    const active = oldRules.filter(row => row.deleted_at === null);
    const observed: Activity = { ...empty(), observedRows: [{ table: "price_list", row: root }, ...active.map(row => ({ table: "price_list_rule", row }))],
      relationalReads: [read("price_list", plan.rootQuery, [root], true), read("price_list_rule", ruleQuery, active, true)] };
    const request: Call = { ...call(observed), commandName: "pricingListUpdateRead", mode: "read", input,
      result: [{ id: root.id!, price_list_rules: active.map(row => ({ id: row.id!, attribute: row.attribute!, value: row.value! })) }], events: [] };
    await Effect.runPromise(policy.validateLogicalCall(request, observed));
    await refused({ ...request, result: [{ id: root.id!, price_list_rules: active.map(childDto) }] }, observed);
    await refused(request, { ...observed, relationalReads: observed.relationalReads.slice(0, 1) });
    await refused(request, { ...observed, observedRows: [{ table: "price_list", row: { ...root, id: "foreign153" } }, ...observed.observedRows.slice(1)] });
  });

  it("authenticates complete replacement attempts, all history and exact native event identities", async () => {
    const observed = activity(), request = call(observed); await Effect.runPromise(policy.validateLogicalCall(request, observed));
    await refused({ ...request, events: request.events.slice(1) }, observed);
    await refused({ ...request, events: [...request.events].reverse() }, observed);
    await refused({ ...request, events: [...request.events, event("price_list", "updated", "forged153")] }, observed);
    await refused(request, { ...observed, mutations: observed.mutations.filter(change => change.before?.id !== oldRules[2]?.id).map((change, ordinal) => ({ ...change, ordinal })) });
    await refused(request, { ...observed, relationalReads: observed.relationalReads.filter((_, index) => index !== 5) });
  });

  it("refuses sparse omissions, invented scalar fields and cross-owner or reused new Rule IDs", async () => {
    const observed = activity(), request = call(observed);
    for (const result of [[{ id: root.id!, rules_count: 2, price_list_rules: newRules.map(childDto) }],
      [{ id: root.id!, title: "after153", description: "", rules_count: 2, price_list_rules: newRules.map(childDto) }],
      [{ id: root.id!, title: "after153", rules_count: 2, price_list_rules: [...newRules].reverse().map(childDto) }]]) await refused({ ...request, result }, observed);
    await refused(request, { ...observed, mutations: observed.mutations.map(change => change.operation === "insert" ? { ...change, after: { ...change.after, price_list_id: "foreign153" } } : change) });
    await refused(request, { ...observed, mutations: observed.mutations.map(change => change.operation === "insert" ? { ...change, after: { ...change.after, id: oldRules[0]?.id! } } : change) });
  });

  it("requires preserved root managed fields and one actual patch per updated action", async () => {
    const observed = activity(), request = call(observed);
    await refused(request, { ...observed, mutations: observed.mutations.map(change => change.table === "price_list" ? { ...change, after: { ...after, updated_at: childStamp } } : change) });
    await refused(request, { ...observed, mutations: observed.mutations.map(change => change.table === "price_list" ? { ...change, before: { ...root, _id: "before153" }, after: { ...after, _id: "after153" } } : change) });
    await refused(request, { ...observed, mutations: observed.mutations.filter(change => change.table !== "price_list") });
    await refused(request, { ...observed, mutations: observed.mutations.map(change => change.table === "price_list" ? { ...change, before: { ...root, deleted_at: stamp } } : change) });
  });

  it("keeps ID-only root attempts/events without inventing child mutations", async () => {
    const observed: Activity = { ...empty(), observedRows: [{ table: "price_list", row: root }, ...oldRules.map(row => ({ table: "price_list_rule", row }))],
      mutations: [{ ordinal: 0, table: "price_list", operation: "patch", before: root, after: root }],
      relationalReads: [preRead([String(root.id)], [root]), read("price_list", query("id", [root.id!]), [root]),
        read("price_list_rule", query("price_list_id", [root.id!], true), oldRules, true)] };
    const request: Call = { ...call(observed), input: [{ id: root.id! }], result: [{ id: root.id! }], events: [event("price_list", "updated", root.id!)] };
    await Effect.runPromise(policy.validateLogicalCall(request, observed));
    await refused({ ...request, events: [] }, observed); await refused(request, { ...observed, mutations: [] });
    await expect(Effect.runPromise(policy.capture(event("price_list_rule", "updated", "rule153")))).rejects.toMatchObject({ reason: "unadmittedEvent" });
  });

  it("authenticates an actual empty module update read without inventing writes or messages", async () => {
    const observed: Activity = { ...empty(), relationalReads: [preRead([], [])] };
    const request: Call = { ...call(observed), input: [], result: [], events: [] };
    await Effect.runPromise(policy.validateLogicalCall(request, observed));
    await refused(request, empty()); await refused({ ...request, events: [event("price_list", "updated", root.id!)] }, observed);
  });
});
