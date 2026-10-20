import { preparePricingPreferencePolicy } from "./support/logical-pricing-fixture";
import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizePrices } from "@medusajs/pricing/normalization";
import { commerceRelationReadQuery } from "../src/query/relations";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureCommerceInput } from "../src/value/input";
import { preparePricingRepository } from "../src/modules/pricing/repository";
import { pricingLogicalMutationEventPolicy } from "../src/modules/pricing/mutation-events";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compileShippingPricingOutput, compileShippingPricingMutationContracts, decodeShippingNormalizedPriceCreate } from "../src/modules/pricing/shipping-input";
import { pricingShippingOptionPolicy } from "../src/modules/pricing/shipping-receipt";
import { makeLocalPricingCommands, shippingPricingLifecycleServiceDefinition } from "../src/modules/pricing/service";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
let contracts: Result.Result.Success<ReturnType<typeof compileShippingPricingMutationContracts>>;
let policy: ReturnType<typeof pricingShippingOptionPolicy>;
let prepared: Result.Result.Success<ReturnType<typeof preparePricingRepository>>;
const old = "2026-10-18T01:00:00.000Z", now = "2026-10-18T02:00:00.000Z";
const root: JsonObject = { id: "s", created_at: old, updated_at: old, deleted_at: null };
const price: JsonObject = { id: "p", price_set_id: "s", price_list_id: null, title: null, currency_code: "usd",
  amount: "10.000000000000000000", raw_amount: { value: "10.000000000000000000", precision: 20 },
  min_quantity: null, raw_min_quantity: null, max_quantity: null, raw_max_quantity: null, rules_count: 1,
  created_at: old, updated_at: old, deleted_at: null };
const rule: JsonObject = { id: "r", price_id: "p", attribute: "cart_total", operator: "gte", value: "100", priority: 0,
  created_at: old, updated_at: old, deleted_at: null };
const empty = (): Activity => ({ mutations: [], lifecycle: [], observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const event = (table: string, action: string, id: string): Json => ({ name: "pricing." + table.replaceAll("_", "-") + "." + action,
  metadata: { source: "pricing", object: table, action }, data: { id } });
const receipt = (commandName: string, input: Json, result: Json, events: readonly Json[], activity: Activity): Receipt => ({
  commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: activity.mutations.length,
  fromLifecycle: 0, toLifecycle: activity.lifecycle.length });
const refused = async (call: Receipt, activity: Activity) =>
  expect(Result.isFailure(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))).toBe(true);

beforeAll(async () => {
  const { frame } = await Effect.runPromise(capturePricingMetadata());
  contracts = Result.getOrThrow(compileShippingPricingMutationContracts(frame));
  prepared = Result.getOrThrow(preparePricingRepository(frame, "shipping-option-updates"));
  policy = pricingShippingOptionPolicy(await preparePricingPreferencePolicy(), Result.getOrThrow(compileShippingPricingOutput(frame)), contracts, prepared);
});

describe("Shipping Option update Pricing boundaries", () => {
  it("exposes only the four selected native update and compensation methods", async () => {
    const update = await Effect.runPromise(makeLocalPricingCommands("shipping-option-updates"));
    expect(Object.keys(update.workflow.methods).sort()).toEqual(["createPriceRules", "listPriceRules", "listPrices", "updatePriceSets"]);
    expect(shippingPricingLifecycleServiceDefinition(update.workflow)).toBeUndefined();
    const create = await Effect.runPromise(makeLocalPricingCommands("shipping-options"));
    expect(create.workflow.methods.updatePriceSets).toBeUndefined();
    expect(create.workflow.methods.createPriceRules).toBeUndefined();
  });

  it("preserves scalar IDs, empty prices and native raw rule validation order", () => {
    for (const prices of [[], [{ id: "p" }], [{ id: "p", amount: 20 }], [{ id: "p", price_set_id: "s", currency_code: "usd", amount: 20, rules: {} }],
      [{ currency_code: "usd", amount: 20, rules: { cart_total: [{ operator: "native-invalid-operator", value: 100 }] } }]]) {
      const input = { selector: "s", update: { prices } };
      expect(Result.getOrThrow(contracts.decodeUpdate(input))).toEqual(input);
    }
    expect(Result.isFailure(contracts.decodeUpdate({ selector: { id: "s" }, update: { prices: [] } }))).toBe(true);
    expect(Result.isFailure(contracts.decodeUpdate({ selector: "s", update: {} }))).toBe(true);
    expect(Result.isFailure(contracts.decodeUpdate({ selector: "s", update: { prices: [{ currency_code: "usd", amount: 1,
      rules: { cart_total: [{ operator: "gte", value: "100" }] } }] } }))).toBe(true);
  });

  it("requires complete DML retained Price and Rule DTOs including exact companions and original stamps", () => {
    const retained = { ...price, amount: 10, price_rules: [rule] };
    const input = { selector: "s", update: { prices: [retained] } };
    expect(Result.getOrThrow(contracts.decodeUpdate(input))).toEqual(input);
    for (const field of Object.keys(retained)) {
      const partial: Record<string, Json> = { ...retained }; delete partial[field];
      expect(Result.isFailure(contracts.decodeUpdate({ selector: "s", update: { prices: [partial] } }))).toBe(true);
    }
    const rules = Array.from({ length: 24 }, (_, index) => ({ ...rule, id: "r" + index }));
    expect(Result.getOrThrow(contracts.decodeRuleRows(rules))).toEqual(rules);
    expect(Result.isFailure(contracts.decodeRuleRows([...rules, { ...rule, id: "twenty-fifth" }]))).toBe(true);
    expect(Result.getOrThrow(contracts.decodeRuleReadOutput([{ id: "r" }]))).toEqual([{ id: "r" }]);
    expect(Result.getOrThrow(contracts.decodeRuleReadOutput([rule]))).toEqual([rule]);
    expect(Result.isFailure(contracts.decodeRuleReadOutput([{ id: "r", value: "100" }]))).toBe(true);
  });

  it("materializes the native base-price null before exact retained-row reconstitution", () => {
    const retained = { ...price, price_rules: [rule] };
    // Execute the actual native inverse normalization: it overwrites the
    // retained null with undefined, which checked JSON capture then omits.
    const normalized: unknown = Reflect.apply(normalizePrices, undefined, [[structuredClone(retained)], []]);
    const captured = Result.getOrThrow(captureCommerceInput(normalized));
    if (!Array.isArray(captured) || !isJsonObject(captured[0])) throw new Error("Expected one normalized native Price");
    const input = captured[0];
    expect(Object.hasOwn(input, "price_list_id")).toBe(false);
    const restored = Result.getOrThrow(decodeShippingNormalizedPriceCreate(input));
    expect(restored).toEqual(retained);
    expect(Result.getOrThrow(decodeShippingNormalizedPriceCreate({ ...input, price_list_id: null }))).toEqual(retained);
    expect(Result.isFailure(decodeShippingNormalizedPriceCreate({ ...input, price_list_id: "unadmitted-list" }))).toBe(true);
  });

  it("authenticates scalar native updates without inventing unreturned Rule population", async () => {
    const after = { ...price, amount: "20.000000000000000000", raw_amount: { value: "20.000000000000000000", precision: 20 }, updated_at: now };
    const output = { ...root, prices: [{ ...after, amount: 20, price_list: null }] };
    expect(Result.getOrThrow(contracts.decodeOutput(output))).toEqual(output);
    const activity: Activity = { ...empty(), observedRows: [{ table: "price_set", row: root }, { table: "price", row: price },
      { table: "price_rule", row: rule }], mutations: [{ ordinal: 0, table: "price", operation: "patch", before: price, after }] };
    const rootRead = () => {
      if (!prepared.query) throw new Error("Missing native PriceSet read planner");
      return { table: "price_set", query: commerceRelationReadQuery(defaultCommerceResources,
        Result.getOrThrow(prepared.query(Result.getOrThrow(captureCommerceInput(buildQuery({ id: "s" }))))).query.predicate), total: 1, returned: 1 };
    };
    const priceRead = (filters: JsonObject) => {
      if (!prepared.mutationQuery) throw new Error("Missing native mutation read planner");
      return { table: "price", query: commerceRelationReadQuery(defaultCommerceResources,
        Result.getOrThrow(prepared.mutationQuery("price", Result.getOrThrow(captureCommerceInput(buildQuery(filters))))).query.predicate), total: 1, returned: 1 };
    };
    const ruleRead = () => ({ table: "price_rule", query: commerceRelationReadQuery(defaultCommerceResources,
      { kind: "and", children: [{ kind: "in", column: "price_id", values: ["p"] }, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 });
    const evidence: Activity = { ...activity, relationalReads: [rootRead(), priceRead({ price_set_id: ["s"], price_list_id: null }), ruleRead(),
      priceRead({ $or: [{ id: "p" }] }), rootRead(), { table: "price", query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "and", children: [{ kind: "in", column: "price_set_id", values: ["s"] }, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 }, ruleRead()] };
    const call = receipt("pricingUpdate", { selector: "s", update: { prices: [{ id: "p", currency_code: "usd", amount: 20, rules: {} }] } },
      output, [event("price", "updated", "p")], activity);
    await Effect.runPromise(policy.validateLogicalCall(call, evidence));
    await refused({ ...call, result: [output] }, evidence);
    await refused({ ...call, input: { selector: { id: "s" }, update: { prices: [] } } }, evidence);
    await refused({ ...call, events: [] }, evidence);
    await refused({ ...call, result: { ...root, prices: [] } }, evidence);
    for (const prices of [[], [{ id: "p", currency_code: "usd", amount: 999, rules: {} }]]) {
      const forged = { ...call, input: { selector: "s", update: { prices } } };
      // Retain the prior mechanical-only counterexample separately: the
      // selected native proof must reject both otherwise valid row transcripts.
      await Effect.runPromise(pricingLogicalMutationEventPolicy(await preparePricingPreferencePolicy(), { scalarPriceSetUpdate: true }).validateLogicalCall(forged, evidence));
      await refused(forged, evidence);
    }
    await refused(call, activity);
    await refused(call, { ...evidence, relationalReads: [...evidence.relationalReads, ...evidence.relationalReads.slice(0, 1)] });
  });

  it("authenticates reconstituted Rule IDs and original created_at with renewed updated_at", async () => {
    const after = { ...rule, updated_at: now };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "price_rule", operation: "insert", before: null, after }] };
    const call = receipt("pricingShippingCreatePriceRules", [rule], [after], [event("price_rule", "created", "r")], activity);
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    await refused({ ...call, input: [{ ...rule, id: "different" }] }, activity);
    await refused({ ...call, input: [{ ...rule, created_at: now }] }, activity);
    await refused({ ...call, events: [] }, activity);
    await refused({ ...call, result: [{ ...after, priority: 1 }] }, activity);
  });

  it("binds native flat Rule capture and ID prechecks to exact complete indexed read evidence", async () => {
    const full: Receipt = { ...receipt("pricingShippingListPriceRules", { filters: { price_id: ["p"] }, config: {} }, [rule], [], empty()), mode: "read" };
    const activity: Activity = { ...empty(), observedRows: [{ table: "price_rule", row: rule }], relationalReads: [{ table: "price_rule",
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
        { kind: "in", column: "price_id", values: ["p"] }, { kind: "isNull", column: "deleted_at" },
      ] }), total: 1, returned: 1 }] };
    await Effect.runPromise(policy.validateLogicalCall(full, activity));
    await refused(full, { ...activity, relationalReads: [] });
    await refused({ ...full, result: [{ ...rule, value: "forged" }] }, activity);
    await refused(full, { ...activity, observedRows: [...activity.observedRows, { table: "price_rule", row: { ...rule, id: "outside", price_id: "other" } }] });
    const selected: Receipt = { ...full, input: { filters: { id: ["r"] }, config: { select: ["id"] } }, result: [{ id: "r" }] };
    const selectedActivity: Activity = { ...activity, relationalReads: [{ table: "price_rule", query: commerceRelationReadQuery(defaultCommerceResources,
      { kind: "and", children: [{ kind: "and", children: [{ kind: "in", column: "id", values: ["r"] }] }, { kind: "isNull", column: "deleted_at" }] }), total: 1, returned: 1 }] };
    await Effect.runPromise(policy.validateLogicalCall(selected, selectedActivity));
    await refused({ ...selected, result: [rule] }, selectedActivity);
    await Effect.runPromise(policy.validateLogicalCall({ ...full, input: { filters: { price_id: [] }, config: {} }, result: [] }, empty()));
  });
});
