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
import { captureFulfillmentItemQuantity } from "../src/modules/fulfillment/fulfillment-create-value-profile";

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
const reads = (filters: JsonObject, root = row(), active: Readonly<Record<string, number>> = { provider: 1 }) => [rootRead(filters), ...prepared.contracts.referenceFields.flatMap(field => {
  const selection = Result.getOrThrow(prepareCommerceRelationPopulation(["id"], [root], [field.column], true, false));
  return Option.isNone(selection) ? [] : [{ table: field.entity.table.name,
    query: commerceRelationReadQuery(defaultCommerceResources, selection.value.predicate), total: active[field.name] ?? 0, returned: active[field.name] ?? 0 }];
})];

beforeAll(async () => {
  prepared = Result.getOrThrow(prepareFulfillmentCreationRepository((await Effect.runPromise(captureFulfillmentCreationMetadata())).frame));
  policy = fulfillmentCreationPolicy(prepared);
});

describe("causal native Fulfillment creation receipts", () => {
  it("requires the native Item numeric DTO instead of its persisted quantity string", async () => {
    const first = row({}), request = { title: "Fraction", sku: "sku", barcode: "barcode", quantity: 0.125 },
      input = { location_id: "location", provider_id: "manual_manual", items: [request], delivery_address: null, data: {} };
    const item: JsonObject = { ...prepared.contracts.defaults.get("fulfillment_item"),
      ...await Effect.runPromise(captureFulfillmentItemQuantity(request)), id: "item", fulfillment_id: "f",
      created_at: before, updated_at: before, deleted_at: null };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment", operation: "insert", before: null, after: first },
      { ordinal: 1, table: "fulfillment_item", operation: "insert", before: null, after: item }],
      observedRows: [...observed(first), { table: "fulfillment_item", row: item }], relationalReads: reads({ $or: [{ id: "f" }] }) };
    const initial = prepared.contracts.initializeCreation(first, new Map([["fulfillment_item", [item]]]), Result.getOrThrow(decodeFulfillmentCreate(input))),
      result = await Effect.runPromise(prepared.contracts.serialize(initial));
    if (Array.isArray(result)) throw new Error("Expected one native Fulfillment");
    const itemEvent = { name: "fulfillment.fulfillment-item.created", metadata: { source: "fulfillment", object: "fulfillment_item", action: "created" }, data: { id: "item" } };
    const receipt = call("fulfillmentCreateForWorkflow", input, result, [event("created"), itemEvent], activity);
    expect(result.items).toMatchObject([{ quantity: 0.125, raw_quantity: { value: "0.125", precision: 20 } }]);
    expect(typeof item.quantity).toBe("string");
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, result: { ...result, items: [item] } }, activity))).toBe(true);
  });

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
    const retrieved = await Effect.runPromise(prepared.contracts.serialize(prepared.contracts.initializeRead(final,
      { provider: provider(), delivery_address: null, shipping_option: null })));
    expect(retrieved).not.toHaveProperty("delivery_address_id"); expect(result).toHaveProperty("delivery_address_id", null);
    expect(Result.isSuccess(await validate(call("fulfillmentCancelForWorkflow", "f", retrieved, [], noop), noop))).toBe(true);
    expect(Result.isFailure(await validate(call("fulfillmentCancelForWorkflow", "f", retrieved, [event("updated")], noop), noop))).toBe(true);
    expect(Result.isFailure(await validate(call("fulfillmentCancelForWorkflow", "f", result, [], noop), noop))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, result: retrieved }, activity))).toBe(true);
  });

  it("authenticates filtered historical Option visibility without accepting a stored-FK rewrite", async () => {
    const first = { ...row({ kept: true }), shipping_option_id: "historical-option" }, final = { ...first, canceled_at: after, updated_at: after };
    const historical: JsonObject = { ...prepared.contracts.defaults.get("shipping_option"), id: "historical-option", name: "Historical Option", price_type: "flat",
      service_zone_id: "zone", shipping_option_type_id: "type", created_at: before, updated_at: after, deleted_at: after };
    expect(Result.isSuccess(prepared.contracts.option.decodeRow(historical))).toBe(true);
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment", operation: "patch", before: first, after: final }],
      observedRows: [...observed(first, final), { table: "shipping_option", row: historical }], relationalReads: [...reads({ id: "f" }, first), ...reads({ $or: [{ id: "f" }] }, first)] };
    const result = await Effect.runPromise(prepared.contracts.serialize(prepared.contracts.initializeRead(final,
      { provider: provider(), shipping_option: null, delivery_address: null }, "assigned")));
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

  it("authenticates historical Provider and Address ID reconstitution without mutating either stored FK", async () => {
    const first = { ...row({ kept: true }), delivery_address_id: "historical-address" }, final = { ...first, canceled_at: after, updated_at: after },
      historicalProvider = { ...provider(), deleted_at: after },
      historicalAddress = { ...prepared.contracts.defaults.get("fulfillment_address"), id: "historical-address",
        created_at: before, updated_at: after, deleted_at: after };
    const activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment", operation: "patch", before: first, after: final }],
      observedRows: [{ table: "fulfillment", row: final }, { table: "fulfillment_provider", row: historicalProvider },
        { table: "fulfillment_address", row: historicalAddress }],
      relationalReads: [...reads({ id: "f" }, first, {}), ...reads({ $or: [{ id: "f" }] }, first, {})] };
    const result = await Effect.runPromise(prepared.contracts.serialize(prepared.contracts.initializeRead(final,
      { provider: null, delivery_address: null, shipping_option: null }, "assigned")));
    if (Array.isArray(result)) throw new Error("Expected one native Fulfillment");
    const receipt = call("fulfillmentCancelForWorkflow", "f", result, [event("updated")], activity);
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(result).toMatchObject({ provider_id: "manual_manual", provider: { id: "manual_manual" },
      delivery_address_id: "historical-address", delivery_address: { id: "historical-address" } });
    const forgeries: readonly JsonObject[] = [{ provider_id: null, provider: null }, { delivery_address_id: null, delivery_address: null }];
    for (const forged of forgeries)
      expect(Result.isFailure(await validate({ ...receipt, result: { ...result, ...forged } }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, mutations: [{ ...activity.mutations[0]!, after: { ...final, provider_id: null } }] }))).toBe(true);
  });
});

describe("causal native shipment receipts", () => {
  const selectionReads = (filters: JsonObject, config: JsonObject, root: JsonObject, children: ReadonlyMap<string, readonly JsonObject[]> = new Map()) => {
    const plan = Result.getOrThrow(prepared.shipment.reads.query(buildQuery(filters, config)));
    return [{ table: "fulfillment", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 },
      ...plan.paths.flatMap(path => {
        const relation = prepared.contracts.queryRelations.get("fulfillment")?.get(path);
        if (!relation || relation.join.type === "manyToMany") throw new Error("Expected admitted native relation");
        const toOne = relation.join.type === "belongsTo", selected = Result.getOrThrow(prepareCommerceRelationPopulation(
          toOne ? relation.targetPrimaryKeys : relation.join.foreignKeys, [root], toOne ? relation.join.foreignKeys : relation.sourcePrimaryKeys, true, false));
        if (Option.isNone(selected)) return [];
        const rows = relation.targetTable === "fulfillment_provider" ? [provider()] : children.get(relation.targetTable) ?? [];
        const active = rows.filter(row => row.deleted_at === null), count = active.length, order = prepared.shipment.reads.ordering.get(relation.targetTable);
        const orderedIdentities = active.map(row => {
          const id = row.id;
          if (typeof id !== "string") throw new Error("Expected a checked fixture row identity");
          return { id };
        });
        return [{ table: relation.targetTable, query: commerceRelationReadQuery(defaultCommerceResources, selected.value.predicate, order), total: count, returned: count,
          ...(order !== undefined && typeof order !== "string" ? { orderedIdentities } : {}) }];
      })];
  };
  const rawRead = (table: string, column: string, values: readonly string[], count: number, identities: readonly string[] = []) => {
    const order = prepared.shipment.reads.ordering.get(table);
    return { table, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values }, order), total: count, returned: count,
      ...(order !== undefined && typeof order !== "string" ? { orderedIdentities: identities.map(id => ({ id })) } : {}) };
  };
  const labelEvent = (id: string, action: "created" | "updated" | "deleted"): Json => ({ name: buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "fulfillment_label", action }),
    metadata: { source: Modules.FULFILLMENT, object: "fulfillment_label", action }, data: { id } });

  it("authenticates the exact selected historical Option scalar and its separate retained identity", async () => {
    const first = { ...row({}), shipping_option_id: "historical-option" }, config = { select: ["shipped_at", "canceled_at", "shipping_option_id"] },
      option: JsonObject = { ...prepared.contracts.defaults.get("shipping_option"), id: "historical-option", name: "Historical", price_type: "flat",
        service_zone_id: "zone", shipping_option_type_id: "type", created_at: before, updated_at: after, deleted_at: after };
    const result = { id: "f", shipped_at: null, canceled_at: null, shipping_option_id: null, shipping_option: { id: "historical-option" } },
      activity: Activity = { ...empty(), observedRows: [{ table: "fulfillment", row: first }, { table: "shipping_option", row: option }],
        relationalReads: selectionReads({ id: "f" }, config, first, new Map([["shipping_option", [option]]])) },
      receipt: Call = { ...call("fulfillmentRetrieveForWorkflow", { id: "f", config }, result, [], activity), mode: "read" };
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, result: { ...result, shipping_option: null } }, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, input: { id: "f", config: { select: ["shipped_at"] } } }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, relationalReads: [...activity.relationalReads, rootRead({ id: "f" })] }))).toBe(true);
  });

  it("binds shipment scalar updates to the request, native hydration and exact read coverage", async () => {
    const first = row({ kept: true }), final = { ...first, shipped_at: after, updated_at: after },
      activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment", operation: "patch", before: first, after: final }], observedRows: observed(final),
        relationalReads: [...selectionReads({ id: "f" }, { relations: ["items", "labels"] }, first), ...reads({ $or: [{ id: "f" }] }, first),
          rawRead("fulfillment", "id", ["f"], 1), rawRead("fulfillment_label", "fulfillment_id", ["f"], 0), rawRead("fulfillment_item", "fulfillment_id", ["f"], 0),
          rawRead("fulfillment_label", "fulfillment_id", ["f"], 0)] },
      result = await Effect.runPromise(prepared.contracts.serialize({ ...prepared.contracts.initialize(final), items: [], labels: [] })),
      input = { id: "f", update: { shipped_at: after, labels: [] } }, receipt = call("fulfillmentUpdateForShipment", input, result, [event("updated")], activity);
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, input: { ...input, update: { ...input.update, marked_shipped_by: "forged" } } }, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, input: { ...input, update: { shipped_at: after, labels: [{ tracking_number: "n", tracking_url: "u", label_url: "l" }] } } }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, relationalReads: activity.relationalReads.slice(1) }))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, observedRows: [...activity.observedRows, { table: "fulfillment", row: { ...final, updated_at: before } }] }))).toBe(true);
  });

  it("correlates fresh replacement Label IDs and timestamps while rejecting unrelated child effects", async () => {
    const first = row({}), final = { ...first, shipped_at: after, updated_at: after }, request = { tracking_number: "new", tracking_url: "url", label_url: "label" },
      oldLabel = { id: "old", fulfillment_id: "f", tracking_number: "old", tracking_url: "old-url", label_url: "old-label", created_at: before, updated_at: before, deleted_at: null },
      newLabel = { ...request, id: "new", fulfillment_id: "f", created_at: after, updated_at: after, deleted_at: null },
      activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment_label", operation: "delete", before: oldLabel, after: null },
        { ordinal: 1, table: "fulfillment_label", operation: "insert", before: null, after: newLabel },
        { ordinal: 2, table: "fulfillment", operation: "patch", before: first, after: final }],
        observedRows: [...observed(final), { table: "fulfillment_label", row: newLabel }],
        relationalReads: [...selectionReads({ id: "f" }, { relations: ["items", "labels"] }, first, new Map([["fulfillment_label", [oldLabel]]])),
          ...reads({ $or: [{ id: "f" }] }, first), rawRead("fulfillment", "id", ["f"], 1), rawRead("fulfillment_label", "fulfillment_id", ["f"], 1, ["old"]),
          rawRead("fulfillment_label", "id", ["new"], 0), rawRead("fulfillment_item", "fulfillment_id", ["f"], 0), rawRead("fulfillment_label", "fulfillment_id", ["f"], 1, ["new"])] },
      result = await Effect.runPromise(prepared.contracts.serialize({ ...prepared.contracts.initialize(final), items: [], labels: [newLabel] })),
      receipt = call("fulfillmentUpdateForShipment", { id: "f", update: { shipped_at: after, labels: [request] } }, result,
        [labelEvent("new", "created"), event("updated"), labelEvent("old", "deleted")], activity);
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    expect(Result.isFailure(await validate({ ...receipt, events: [event("updated"), labelEvent("new", "created"), labelEvent("old", "deleted")] }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, mutations: activity.mutations.map(change => change.ordinal === 1
      ? { ...change, after: { ...newLabel, fulfillment_id: "outside" } } : change) }))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, mutations: activity.mutations.map(change => change.ordinal === 1
      ? { ...change, after: { ...newLabel, created_at: before } } : change) }))).toBe(true);
  });

  it("authenticates complete retained Label DTOs with both original timestamps instead of fresh insertion stamps", async () => {
    const first = { ...row({}), shipped_at: after }, final = { ...first, shipped_at: null, updated_at: after },
      labelUpdated = "2026-10-18T01:30:00.000Z",
      retainedLabel = { id: "restored", fulfillment_id: "f", tracking_number: "original", tracking_url: "original-url", label_url: "original-label",
        created_at: before, updated_at: labelUpdated, deleted_at: null },
      activity: Activity = { ...empty(), mutations: [{ ordinal: 0, table: "fulfillment_label", operation: "insert", before: null, after: retainedLabel },
        { ordinal: 1, table: "fulfillment", operation: "patch", before: first, after: final }],
        observedRows: [...observed(final), { table: "fulfillment_label", row: retainedLabel }],
        relationalReads: [...selectionReads({ id: "f" }, { relations: ["items", "labels"] }, first), ...reads({ $or: [{ id: "f" }] }, first),
          rawRead("fulfillment", "id", ["f"], 1), rawRead("fulfillment_label", "fulfillment_id", ["f"], 0),
          rawRead("fulfillment_label", "id", ["restored"], 0), rawRead("fulfillment_item", "fulfillment_id", ["f"], 0),
          rawRead("fulfillment_label", "fulfillment_id", ["f"], 1, ["restored"])] },
      input = { id: "f", update: { shipped_at: null, labels: [retainedLabel] } },
      result = await Effect.runPromise(prepared.contracts.serialize({ ...prepared.contracts.initialize(final), items: [], labels: [retainedLabel] })),
      receipt = call("fulfillmentUpdateForShipment", input, result, [labelEvent("restored", "created"), event("updated")], activity);
    expect(retainedLabel.created_at).not.toBe(retainedLabel.updated_at);
    expect(Result.isSuccess(await validate(receipt, activity))).toBe(true);
    for (const name of ["created_at", "updated_at", "deleted_at"] as const) {
      const partial = Object.fromEntries(Object.entries(retainedLabel).filter(([field]) => field !== name));
      expect(Result.isFailure(await validate({ ...receipt, input: { ...input, update: { ...input.update, labels: [partial] } } }, activity))).toBe(true);
    }
    const forgeries: readonly JsonObject[] = [{ fulfillment_id: "outside" }, { tracking_number: "altered" }, { created_at: after }, { updated_at: after }, { deleted_at: after }];
    for (const forged of forgeries)
      expect(Result.isFailure(await validate({ ...receipt, input: { ...input, update: { ...input.update, labels: [{ ...retainedLabel, ...forged }] } } }, activity))).toBe(true);
    expect(Result.isFailure(await validate(receipt, { ...activity, mutations: [{ ...activity.mutations[0]!, after: { ...retainedLabel, updated_at: after } }, activity.mutations[1]!] }))).toBe(true);
  });
});
