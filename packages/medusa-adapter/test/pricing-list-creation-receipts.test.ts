import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata, compilePricingDefinition } from "../src/modules/pricing/schema";
import { captureVariantPricingLinkMetadata, compileVariantPricingLinkDefinition } from "../src/composition/product-variant-pricing-schema";
import { compilePriceListCreationContracts } from "../src/modules/pricing/list-input";
import { pricingListCreationPolicy } from "../src/modules/pricing/list-creation-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { validateRelationalRowValues } from "flarex-protocol/internal/relational-schema";
import { priceListCreationComparisonRows } from "./support/logical-price-list-create-fixture";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof pricingListCreationPolicy>;
const stamp = "2026-10-20T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const root: JsonObject = { id: "plist_unit152", title: "unit152", description: "", status: "draft", type: "sale",
  starts_at: null, ends_at: null, rules_count: 1, ...managed };
const price: JsonObject = { id: "price_unit152", title: null, currency_code: "USD", amount: "1.0000000000000000000",
  raw_amount: { value: "1.0000000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
  max_quantity: null, raw_max_quantity: null, rules_count: 1, price_list_id: root.id!, price_set_id: "pset_protected152", ...managed };
const rule: JsonObject = { id: "prule_unit152", price_id: price.id!, attribute: "arbitrary", value: "", operator: "eq", priority: 0, ...managed };
const listRule: JsonObject = { id: "plrule_unit152", price_list_id: root.id!, attribute: "", value: [], ...managed };
const entries = [{ table: "price_list", row: root }, { table: "price_list_rule", row: listRule },
  { table: "price", row: price }, { table: "price_rule", row: rule }];
const output: Json = [{ ...root, prices: [{ ...price, amount: 1, price_rules: [rule] }], price_list_rules: [listRule] }];
const input: Json = [{ title: "unit152", description: "", rules: { "": [] }, prices: [{ price_set_id: "pset_protected152",
  currency_code: "USD", amount: 1, rules: { arbitrary: "" } }] }];
const event = (table: string, id: Json, action = "created"): Json => ({ name: "pricing." + table.replaceAll("_", "-") + "." + action,
  metadata: { source: "pricing", object: table, action }, data: { id } });
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const rootRead = (requested: readonly string[], selected: readonly string[]): Activity["relationalReads"] => [{ table: "price_list",
  query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: requested },
    { kind: "storageInsertion", direction: "asc" }), total: selected.length, returned: selected.length,
  orderedIdentities: selected.map(id => ({ id })) }];
const creation = (): Activity => ({ ...empty(), mutations: entries.map(({ table, row }, ordinal) => ({
  ordinal, table, operation: "insert", before: null, after: row,
})) });
const receipt = (activity: Activity): Call => ({ commandName: "pricingCreateList", mode: "write", input, result: output,
  events: entries.map(({ table, row }) => event(table, row.id!)), fromAttempt: 0, toAttempt: activity.mutations.length,
  fromLifecycle: 0, toLifecycle: 0 });
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => { policy = pricingListCreationPolicy(Result.getOrThrow(compilePriceListCreationContracts(
  (await Effect.runPromise(capturePricingMetadata())).frame))); });

describe("native Price List creation receipts", () => {
  it("validates every comparison seed against the authoritative complete relational row contracts", async () => {
    const pricing = await Effect.runPromise(compilePricingDefinition()), link = await Effect.runPromise(compileVariantPricingLinkDefinition());
    const comparison = priceListCreationComparisonRows((await Effect.runPromise(captureVariantPricingLinkMetadata())).frame.name);
    for (const source of [{ name: "medusa.pricing", schema: pricing.schema, rows: comparison.seedRows },
      { name: "medusa.link.productVariantPriceSet", schema: link.schema, rows: comparison.linkRows }]) {
      for (const entry of source.rows) {
        const table = source.schema.tables.find(table => table.identity.tableId === entry.table);
        if (!table) throw new Error("Unknown comparison source table: " + source.name + "/" + entry.table);
        await Effect.runPromise(Effect.fromResult(validateRelationalRowValues(table, entry.row))
          .pipe(Effect.mapError(cause => new Error("Invalid comparison seed: " + source.name + "/" + entry.table + "/" + entry.row.id, { cause }))));
      }
    }
  });

  it("binds every complete returned row and created event to the actual mutation graph", async () => {
    const activity = creation(), call = receipt(activity); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, events: call.events.slice(1) }, activity);
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    await refused({ ...call, events: [...call.events, event("price", "forged152")] }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.slice(0, 3) });
    await refused(call, { ...activity, mutations: [...activity.mutations, { ordinal: 4, table: "price_preference", operation: "insert", before: null,
      after: { id: "unrelated152", ...managed } }] });
  });

  it("rejects missing DTO fields, wrong native scalars, duplicate children and unrelated child ownership", async () => {
    const activity = creation(), call = receipt(activity);
    for (const result of [[{ ...root, prices: [], price_list_rules: [listRule] }],
      [{ ...root, title: "different152", prices: [{ ...price, amount: 1, price_rules: [rule] }], price_list_rules: [listRule] }],
      [{ ...root, prices: [{ ...price, amount: 1, price_rules: [rule, rule] }], price_list_rules: [listRule] }],
      [{ ...root, prices: [{ ...price, amount: 2, price_rules: [rule] }], price_list_rules: [listRule] }]])
      await refused({ ...call, result }, activity);
    const changed = activity.mutations.map(change => change.table === "price" ? { ...change, after: { ...price, price_list_id: "other152" } } : change);
    await refused(call, { ...activity, mutations: changed });
  });

  it("accepts complete physical closure including history and admits only actual root deletion events", async () => {
    const historical = entries.map(({ table, row }) => ({ table, row: { ...row, deleted_at: stamp } }));
    const activity: Activity = { ...empty(), observedRows: historical,
      mutations: historical.map(({ table, row }, ordinal) => ({ ordinal, table, operation: "delete", before: row, after: null })),
      relationalReads: rootRead([String(root.id)], [String(root.id)]) };
    const call: Call = { ...receipt(activity), commandName: "pricingDeleteList", input: [root.id!], result: null,
      events: [event("price_list", root.id!, "deleted")] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, mutations: activity.mutations.slice(0, 3) });
    await refused({ ...call, input: ["unrelated152"] }, activity);
    await refused({ ...call, events: [] }, activity);
    await refused(call, { ...activity, relationalReads: [] });
    await expect(Effect.runPromise(policy.capture(event("price", price.id!, "deleted")))).rejects.toMatchObject({ reason: "unadmittedEvent" });
  });

  it("accepts actual empty creation and missing-root inverse without invented writes or messages", async () => {
    const activity = empty();
    await Effect.runPromise(policy.validateLogicalCall({ ...receipt(activity), input: [], result: [], events: [] }, activity));
    const missing = { ...activity, relationalReads: rootRead(["missing152"], []) };
    const call: Call = { ...receipt(missing), commandName: "pricingDeleteList", input: ["missing152"], result: null, events: [] };
    await Effect.runPromise(policy.validateLogicalCall(call, missing));
    await refused({ ...call, events: [event("price_list", "missing152", "deleted")] }, missing);
  });
});
