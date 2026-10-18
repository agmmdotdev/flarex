import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compileShippingPricingOutput, decodeShippingPriceSetCreate, decodeShippingPricingLifecycle,
  shippingPricingIds, ShippingNormalizedPrice } from "../src/modules/pricing/shipping-input";
import { decodePriceSetCreate } from "../src/modules/pricing/input";
import { pricingShippingOptionPolicy } from "../src/modules/pricing/shipping-receipt";
import { makeLocalPricingCommands, shippingPricingLifecycleServiceDefinition } from "../src/modules/pricing/service";
import { PricingModuleService } from "@medusajs/pricing/services";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
let decodeOutput: Result.Result.Success<ReturnType<typeof compileShippingPricingOutput>>;
let policy: ReturnType<typeof pricingShippingOptionPolicy>;
const stamp = "2026-10-18T01:00:00.000Z", changed = "2026-10-18T02:00:00.000Z";
const root: JsonObject & { id: string } = { id: "s", created_at: stamp, updated_at: stamp, deleted_at: null };
const price: JsonObject & { id: string } = { id: "p", title: null, currency_code: "usd", amount: "10.000000000000000000",
  raw_amount: { value: "10.000000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
  max_quantity: null, raw_max_quantity: null, rules_count: 1, price_set_id: "s", price_list_id: null,
  created_at: stamp, updated_at: stamp, deleted_at: null };
const rule: JsonObject & { id: string } = { id: "r", attribute: "cart_total", operator: "gte", value: "100", priority: 0, price_id: "p",
  created_at: stamp, updated_at: stamp, deleted_at: null };
const rows = [["price_set", root], ["price", price], ["price_rule", rule]] as const;
const event = (table: string, action: string, id: string): Json => ({ name: "pricing." + table.replaceAll("_", "-") + "." + action,
  metadata: { source: "pricing", object: table, action }, data: { id } });
const empty = (): Activity => ({ mutations: [], lifecycle: [], observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const receipt = (name: string, input: Json, result: Json, events: readonly Json[], activity: Activity): Receipt => ({
  commandName: name, mode: "write", input, result, events,
  fromAttempt: 0, toAttempt: activity.mutations.length, fromLifecycle: 0, toLifecycle: activity.lifecycle.length });
const refused = async (call: Receipt, activity: Activity) =>
  expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))).toBe(true);
const dto = () => [{ ...root, prices: [{ ...price, amount: 10, price_list: null, price_rules: [{ ...rule }] }] }];

beforeAll(async () => {
  decodeOutput = Result.getOrThrow(compileShippingPricingOutput((await Effect.runPromise(capturePricingMetadata())).frame));
  policy = pricingShippingOptionPolicy(decodeOutput);
});

describe("selected Shipping Option Pricing contracts", () => {
  it("authenticates only the Shipping lifecycle service and retains detached full native routing metadata", async () => {
    const shipping = await Effect.runPromise(makeLocalPricingCommands("shipping-options"));
    const definition = shippingPricingLifecycleServiceDefinition(shipping.workflow);
    if (definition === undefined) throw new Error("Missing authenticated Shipping Pricing lifecycle");
    expect(definition.softDelete).toBe(shipping.workflow.methods.softDeletePriceSets);
    expect(definition.restore).toBe(shipping.workflow.methods.restorePriceSets);
    expect(definition.routing.__joinerConfig).toEqual(PricingModuleService.prototype.__joinerConfig());
    definition.routing.__joinerConfig.linkableKeys = {};
    expect(shippingPricingLifecycleServiceDefinition(shipping.workflow)?.routing.__joinerConfig).toEqual(PricingModuleService.prototype.__joinerConfig());
    expect(shippingPricingLifecycleServiceDefinition({ ...shipping.workflow })).toBeUndefined();
    for (const profile of ["create", "variant-updates", "product-updates", "store-preferences"] as const)
      expect(shippingPricingLifecycleServiceDefinition((await Effect.runPromise(makeLocalPricingCommands(profile))).workflow)).toBeUndefined();
  });

  it("admits native numeric and automatic Region rules only in the Shipping input profile", () => {
    const input = [{ prices: [{ currency_code: "usd", amount: 10, rules: {
      cart_total: [{ operator: "gte", value: 100 }, { operator: "lt", value: 500 }], region_id: "reg" } }] }];
    expect(Result.getOrThrow(decodeShippingPriceSetCreate(input))).toEqual(input);
    expect(Result.isFailure(decodePriceSetCreate(input))).toBe(true);
    expect(Result.isSuccess(decodeShippingPriceSetCreate([{ prices: [{ currency_code: "usd", amount: 10,
      rules: { x: [{ operator: "native-invalid-operator", value: 1 }] } }] }]))).toBe(true);
    for (const rules of [{ x: [{ operator: 1, value: 1 }] }, { x: [{ operator: "gt", value: "1" }] }])
      expect(Result.isFailure(decodeShippingPriceSetCreate([{ prices: [{ currency_code: "usd", amount: 10, rules }] }]))).toBe(true);
    expect(Result.isFailure(decodeShippingPriceSetCreate(Array.from({ length: 5 }, () => ({ prices: [] }))))).toBe(true);
  });

  it("retains eight raw cascade entries and the full eight distinct PriceSet deletion forest", () => {
    const selected = Result.getOrThrow(decodeShippingPricingLifecycle({ selector: ["a", "b", "a", "b", "c", "d", "c", "d"], config: {} }));
    expect(shippingPricingIds(selected.selector)).toEqual(["a", "b", "c", "d"]);
    expect(Result.isFailure(decodeShippingPricingLifecycle({ selector: Array.from({ length: 9 }, () => "a"), config: {} }))).toBe(true);
    const maximum = Array.from({ length: 8 }, (_, index) => "set-" + index);
    expect(shippingPricingIds(Result.getOrThrow(decodeShippingPricingLifecycle({ selector: maximum, config: {} })).selector)).toEqual(maximum);
    expect(Result.isFailure(decodeShippingPricingLifecycle({ selector: [...maximum, "ninth"], config: {} }))).toBe(true);
  });

  it("admits only the native empty raw-rule metadata after normalization", () => {
    const decode = Schema.decodeUnknownResult(ShippingNormalizedPrice, { onExcessProperty: "error" });
    const currency = { currency_code: "usd", amount: 10, rules: {} };
    expect(Result.getOrThrow(decode(currency))).toEqual(currency);
    expect(Result.isSuccess(decode({ currency_code: "usd", amount: 10, rules_count: 1,
      price_rules: [{ attribute: "cart_total", operator: "gte", value: "10", priority: 0 }] }))).toBe(true);
    expect(Result.isFailure(decode({ ...currency, rules: { region_id: "reg" } }))).toBe(true);
    expect(Result.isFailure(decode({ ...currency, rules: { cart_total: [{ operator: "gte", value: 10 }] } }))).toBe(true);
  });

  it("requires every actual DML DTO field and refuses missing populated relations or companions", () => {
    const full = dto(); expect(Result.getOrThrow(decodeOutput(full))).toEqual(full);
    const child = full[0]!.prices[0]!;
    for (const field of Object.keys(child)) {
      const omitted: Record<string, Json> = { ...child }; delete omitted[field];
      expect(Result.isFailure(decodeOutput([{ ...root, prices: [omitted] }]))).toBe(true);
    }
    expect(Result.isFailure(decodeOutput([{ ...root, prices: [{ ...child, arbitrary: true }] }]))).toBe(true);
  });

  it("authenticates complete native creates and refuses tampered returned children or missing events", async () => {
    const activity: Activity = { ...empty(), mutations: rows.map(([table, after], ordinal) => ({ ordinal, table, operation: "insert", before: null, after })) };
    const events = rows.map(([table, row]) => event(table, "created", String(row.id)));
    const call = receipt("pricingCreate", [{ id: "s", prices: [{ currency_code: "usd", amount: 10,
      rules: { cart_total: [{ operator: "gte", value: 100 }] } }] }], dto(), events, activity);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, events: events.slice(1) }, activity);
    await refused({ ...call, result: [{ ...root, prices: [] }] }, activity);
    await refused({ ...call, result: [{ ...root, prices: [{ ...dto()[0]!.prices[0], amount: 99 }] }] }, activity);
    const corrupted = dto(); corrupted[0]!.prices[0]!.price_rules[0]!.value = "99";
    await refused({ ...call, result: corrupted }, activity);
  });

  it("requires physical removal of every historical descendant but emits only native root delete events", async () => {
    const activity: Activity = { ...empty(), observedRows: rows.map(([table, row]) => ({ table, row })),
      mutations: [...rows].reverse().map(([table, before], ordinal) => ({ ordinal, table, operation: "delete", before, after: null })) };
    const call = receipt("pricingDeletePriceSets", ["s"], null, [event("price_set", "deleted", "s")], activity);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, mutations: activity.mutations.slice(1) });
    await refused({ ...call, events: [...call.events, event("price", "deleted", "p")] }, activity);
    await refused({ ...call, input: ["different"] }, activity);
  });

  it("authenticates soft-delete maps and preserved non-lifecycle values", async () => {
    const after = rows.map(([table, row]) => ({ table, row: { ...row, deleted_at: changed, updated_at: changed } }));
    const activity: Activity = { ...empty(), observedRows: after,
      mutations: rows.map(([table, before], ordinal) => ({ ordinal, table, operation: "patch", before, after: after[ordinal]!.row })),
      lifecycle: rows.map(([table, row], attemptOrdinal) => ({ table, key: { id: row.id }, operation: "softDelete",
        beforeDeletedAt: null, afterDeletedAt: changed, attemptOrdinal, rowAtOperation: null })) };
    const call = receipt("pricingSoftDeletePriceSets", { selector: ["s"], config: {} },
      { price_set_id: ["s"], price_id: ["p"], price_rule_id: ["r"] }, rows.map(([table, row]) => event(table, "deleted", String(row.id))), activity);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, result: { price_set_id: ["s"] } }, activity);
    await refused(call, { ...activity, mutations: activity.mutations.map((mutation, index) => index === 1
      ? { ...mutation, after: { ...mutation.after, currency_code: "eur" } } : mutation) });
    await refused(call, { ...activity, lifecycle: activity.lifecycle.slice(1) });
  });

  it("keeps native already-active restore updates and refuses invented no-op transitions", async () => {
    const after = rows.map(([table, row]) => ({ table, row: { ...row, updated_at: changed } }));
    const activity: Activity = { ...empty(), observedRows: after,
      mutations: rows.map(([table, before], ordinal) => ({ ordinal, table, operation: "patch", before, after: after[ordinal]!.row })),
      lifecycle: rows.map(([table, row], attemptOrdinal) => ({ table, key: { id: row.id }, operation: "restore", beforeDeletedAt: null,
        afterDeletedAt: null, attemptOrdinal, rowAtOperation: null })) };
    const call = receipt("pricingRestorePriceSets", { selector: ["s"], config: { returnLinkableKeys: ["price_set_id"] } },
      { price_set_id: ["s"] }, rows.map(([table, row]) => event(table, "restored", String(row.id))), activity);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, events: call.events.slice(1) }, activity);
    await refused(call, { ...activity, mutations: [], lifecycle: activity.lifecycle.map(transition => ({ ...transition,
      attemptOrdinal: null, rowAtOperation: rows.find(([table]) => table === transition.table)?.[1] ?? null })) });
  });

  it("authenticates the existing eight-Option deletion forest's complete 8/16/48 Pricing closure", async () => {
    const sets = Array.from({ length: 8 }, (_, index) => ({ ...root, id: "set-" + index }));
    const prices = sets.flatMap(set => Array.from({ length: 2 }, (_, index) => ({ ...price,
      id: String(set.id) + "-price-" + index, price_set_id: set.id, rules_count: 3 })));
    const rules = prices.flatMap(price => Array.from({ length: 3 }, (_, index) => ({ ...rule,
      id: String(price.id) + "-rule-" + index, price_id: price.id, priority: index,
      attribute: index === 2 ? "region_id" : "cart_total", operator: index === 0 ? "gte" : index === 1 ? "lt" : "eq" })));
    const forest: Array<readonly [string, JsonObject & { id: string }]> = [
      ...sets.map(row => ["price_set", row] as const), ...prices.map(row => ["price", row] as const), ...rules.map(row => ["price_rule", row] as const),
    ];
    const deleted = forest.map(([table, row]) => ({ table, row: { ...row, deleted_at: changed, updated_at: changed } }));
    const activity: Activity = { ...empty(), observedRows: deleted,
      mutations: forest.map(([table, before], ordinal) => ({ ordinal, table, operation: "patch", before, after: deleted[ordinal]!.row })),
      lifecycle: forest.map(([table, row], attemptOrdinal) => ({ table, key: { id: row.id }, operation: "softDelete",
        beforeDeletedAt: null, afterDeletedAt: changed, attemptOrdinal, rowAtOperation: null })) };
    const call = receipt("pricingSoftDeletePriceSets", { selector: sets.map(row => String(row.id)), config: {} },
      { price_set_id: sets.map(row => String(row.id)), price_id: prices.map(row => String(row.id)), price_rule_id: rules.map(row => String(row.id)) },
      forest.map(([table, row]) => event(table, "deleted", String(row.id))), activity);
    expect(activity.mutations).toHaveLength(72);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused(call, { ...activity, lifecycle: activity.lifecycle.slice(0, -1), mutations: activity.mutations.slice(0, -1) });
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: "price_rule", row: { ...rule, id: "forty-ninth-rule", price_id: prices[0]!.id } }] });
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: "price", row: { ...price, id: "seventeenth-price", price_set_id: sets[0]!.id } }] });
    const restored: Activity = { ...activity, observedRows: forest.map(([table, row]) => ({ table, row: { ...row, updated_at: changed } })),
      mutations: forest.map(([table, before], ordinal) => ({ ordinal, table, operation: "patch", before: deleted[ordinal]!.row,
        after: { ...before, updated_at: changed } })),
      lifecycle: forest.map(([table, row], attemptOrdinal) => ({ table, key: { id: row.id }, operation: "restore",
        beforeDeletedAt: changed, afterDeletedAt: null, attemptOrdinal, rowAtOperation: null })) };
    await Effect.runPromise(policy.validateLogicalCall({ ...call, commandName: "pricingRestorePriceSets",
      events: forest.map(([table, row]) => event(table, "restored", String(row.id))) }, restored));
  });
});
