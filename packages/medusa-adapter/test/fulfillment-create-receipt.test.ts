import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Option, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../src/query/relations";
import { captureCommerceInput } from "../src/value/input";
import { captureFulfillmentCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareFulfillmentCreationRepository } from "../src/modules/fulfillment/fulfillment-create-repository";
import { fulfillmentCreationPolicy } from "../src/modules/fulfillment/fulfillment-create-receipt";
import { decodeFulfillmentCreate } from "../src/modules/fulfillment/fulfillment-create-input";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Call = Parameters<LogicalCallReceiptValidation>[0];
let prepared: Result.Result.Success<ReturnType<typeof prepareFulfillmentCreationRepository>>;
let policy: ReturnType<typeof fulfillmentCreationPolicy>;
const before = "2026-10-18T01:00:00.000Z", after = "2026-10-18T02:00:00.000Z";
const empty = (): Activity => ({ mutations: [], observedRows: [], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [] });
const event = (action: "created" | "updated"): Json => ({ name: buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "fulfillment", action }),
  metadata: { source: Modules.FULFILLMENT, object: "fulfillment", action }, data: { id: "f" } });
const call = (commandName: string, input: Json, result: Json, events: readonly Json[], activity: Activity): Call => ({ commandName,
  mode: "write", input, result, events, fromAttempt: 0, toAttempt: activity.mutations.length, fromLifecycle: 0, toLifecycle: 0 });
const validate = (receipt: Call, activity: Activity) => Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, activity)));
const rootRead = (filters: JsonObject) => {
  const plan = Result.getOrThrow(captureCommerceInput(buildQuery(filters, {})).pipe(Result.flatMap(prepared.query)));
  return { table: "fulfillment", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 };
};
const row = (data: Json = null): JsonObject => ({ ...prepared.contracts.defaults.get("fulfillment"), id: "f", location_id: "location",
  provider_id: "manual_manual", data, created_at: before, updated_at: before, deleted_at: null });
const provider = (): JsonObject => ({ ...prepared.contracts.defaults.get("fulfillment_provider"), id: "manual_manual", is_enabled: true,
  created_at: before, updated_at: before, deleted_at: null });
const observed = (...roots: JsonObject[]) => [{ table: "fulfillment_provider", row: provider() }, ...roots.map(row => ({ table: "fulfillment", row }))];
const reads = (filters: JsonObject, root = row()) => [rootRead(filters), ...prepared.contracts.referenceFields.flatMap(field => {
  const selection = Result.getOrThrow(prepareCommerceRelationPopulation(["id"], [root], [field.column], true, false));
  return Option.isNone(selection) ? [] : [{ table: field.entity.table.name,
    query: commerceRelationReadQuery(defaultCommerceResources, selection.value.predicate), total: field.name === "provider" ? 1 : 0, returned: field.name === "provider" ? 1 : 0 }];
})];

beforeAll(async () => {
  prepared = Result.getOrThrow(prepareFulfillmentCreationRepository((await Effect.runPromise(captureFulfillmentCreationMetadata())).frame));
  policy = fulfillmentCreationPolicy(prepared);
});

describe("causal native Fulfillment creation receipts", () => {
  it("accepts the first null-data DTO separately from the final Manual empty-object row", async () => {
    const first = row(), final = { ...first, data: {}, updated_at: after };
    const input = { location_id: "location", provider_id: "manual_manual", items: [], delivery_address: null };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment", operation: "insert", before: null, after: first },
      { ordinal: 1, table: "fulfillment", operation: "patch", before: first, after: final }], observedRows: observed(final),
      relationalReads: reads({ $or: [{ id: "f" }] }) };
    const result = await Effect.runPromise(prepared.contracts.serialize(prepared.contracts.initializeCreation(first, new Map(), Result.getOrThrow(decodeFulfillmentCreate(input)))));
    if (Array.isArray(result)) throw new Error("Expected one native Fulfillment");
    const receipt = call("fulfillmentCreateForWorkflow", input, result, [event("created"), event("updated")], activity);
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, result: { ...result, data: {} } }, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, input: { ...input, data: { forged: true } } }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, relationalReads: [...activity.relationalReads, rootRead({ id: "f" })] }))).toBe(true);
  });

  it("requires no provider mutation or update event for the empty merge into an existing JSON object", async () => {
    const first = row({ nested: [null, false] }), input = { location_id: "location", provider_id: "manual_manual", items: null,
      data: { nested: [null, false] }, delivery_address: null };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment", operation: "insert", before: null, after: first }],
      observedRows: observed(first), relationalReads: reads({ $or: [{ id: "f" }] }) };
    const result = await Effect.runPromise(prepared.contracts.serialize(prepared.contracts.initializeCreation(first, new Map(), Result.getOrThrow(decodeFulfillmentCreate(input)))));
    const receipt = call("fulfillmentCreateForWorkflow", input, result, [event("created")], activity);
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, events: [...receipt.events, event("updated")] }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "fulfillment", row: { ...first, id: "unrelated" } }] }))).toBe(true);
  });

  it("authenticates cancellation without child writes and retains already-canceled no-op behavior", async () => {
    const first = row({ kept: true }), final = { ...first, canceled_at: after, updated_at: after };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment", operation: "patch", before: first, after: final }],
      observedRows: observed(first, final), relationalReads: [...reads({ id: "f" }), ...reads({ $or: [{ id: "f" }] })] };
    const result = await Effect.runPromise(prepared.contracts.serialize(prepared.contracts.initialize(final)));
    const receipt = call("fulfillmentCancelForWorkflow", "f", result, [event("updated")], activity);
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, input: "outside" }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, mutations: [{ ...activity.mutations[0]!, after: { ...final, data: { forged: true } } }] }))).toBe(true);
    const noop: Activity = { ...empty(), observedRows: observed(final), relationalReads: reads({ id: "f" }) };
    expect(Result.isSuccess(await validate(call("fulfillmentCancelForWorkflow", "f", result, [], noop), noop))).toBe(true);
    expect(Result.isFailure(await validate(call("fulfillmentCancelForWorkflow", "f", result, [event("updated")], noop), noop))).toBe(true);
  });

  it("authenticates filtered historical Option visibility without accepting a stored-FK rewrite", async () => {
    const first = { ...row({ kept: true }), shipping_option_id: "historical-option" }, final = { ...first, canceled_at: after, updated_at: after };
    const historical: JsonObject = { ...prepared.contracts.defaults.get("shipping_option"), id: "historical-option", name: "Historical Option", price_type: "flat",
      service_zone_id: "zone", shipping_option_type_id: "type", created_at: before, updated_at: after, deleted_at: after };
    expect(Result.isSuccess(prepared.contracts.option.decodeRow(historical))).toBe(true);
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment", operation: "patch", before: first, after: final }],
      observedRows: [...observed(first, final), { table: "shipping_option", row: historical }], relationalReads: [...reads({ id: "f" }, first), ...reads({ $or: [{ id: "f" }] }, first)] };
    const result = await Effect.runPromise(prepared.contracts.serialize(prepared.contracts.initializeRead(final,
      { provider: provider(), shipping_option: null, delivery_address: null })));
    if (Array.isArray(result)) throw new Error("Expected one native Fulfillment");
    const receipt = call("fulfillmentCancelForWorkflow", "f", result, [event("updated")], activity);
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(result).toMatchObject({ shipping_option_id: null, shipping_option: null });
    expect(Result.isFailure(await validate({ ...receipt, result: { ...result, shipping_option_id: "historical-option", shipping_option: { id: "historical-option" } } }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, mutations: [{ ...activity.mutations[0]!, after: { ...final, shipping_option_id: null } }] }))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, relationalReads: activity.relationalReads.filter(read => read.table !== "shipping_option") }))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, observedRows: [...observed(first, final),
      { table: "shipping_option", row: { ...historical, id: "outside-fk-selection" } }] }))).toBe(true);
  });
});
