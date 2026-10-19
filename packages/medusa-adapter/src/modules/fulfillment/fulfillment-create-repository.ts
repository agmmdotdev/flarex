import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { populateCommerceRelations } from "../../query/relations";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { commerceMutationEvents } from "../../repository/mutation-events";
import type { commerceRepositoryContext } from "../../repository/context";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { captureGraph, insertGraphRows } from "../../write/create";
import { compileKeyedUpdates } from "../../write/keyed";
import type { CreationProfile, GraphCatalog } from "../../write/graph-model";
import { compileFulfillmentCreationContracts, captureFulfillmentBusinessDates, decodeFulfillmentCreate, decodeFulfillmentNativeUpdate,
  FulfillmentCreationAddress, FulfillmentCreationItem, FulfillmentCreationLabel, FulfillmentCreationId } from "./fulfillment-create-input";
import type { captureFulfillmentCreationMetadata } from "./shipping-profile-schema";
import { captureFulfillmentItemQuantity, selectedManualDataAssignment } from "./fulfillment-create-value-profile";
import { prepareFulfillmentShipmentRepository } from "./fulfillment-shipment-repository";
import { prepareFulfillmentReturnQuery } from "./fulfillment-return-query";

type Metadata = Effect.Success<ReturnType<typeof captureFulfillmentCreationMetadata>>["frame"];
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
  .check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: FulfillmentCreationId })).check(Schema.isLengthBetween(1, 1)) }), "unsupportedProfile");
const decodeId = commerceDecoder(FulfillmentCreationId, "storedCorruption");
const decodeAddress = commerceDecoder(FulfillmentCreationAddress, "invalidInput"), decodeItem = commerceDecoder(FulfillmentCreationItem, "invalidInput"),
  decodeLabel = commerceDecoder(FulfillmentCreationLabel, "invalidInput");

/** This selected DAL grants the four new models only through genuine native
 * Fulfillment create/cancel. The provider and exception paths remain native. */
export function prepareFulfillmentCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileFulfillmentCreationContracts(metadata), shipment = yield* prepareFulfillmentShipmentRepository(contracts),
      returnQuery = yield* prepareFulfillmentReturnQuery(contracts);
    const scalar = yield* prepareScalarRepository(contracts.fulfillment.table, "Fulfillment", scalarIdWhere, shipment.values.serialize);
    const entity = (value: typeof contracts.fulfillment) => ({ table: value.table, model: value.model, keyColumn: "id", prefix: value.table.columns.find(column => column.name === "id")?.options?.prefix });
    const address = entity(contracts.address), fulfillment = entity(contracts.fulfillment), label = entity(contracts.label), item = entity(contracts.item);
    const catalog: GraphCatalog = { entities: [address, fulfillment, label, item], tables: metadata.tables,
      writablePivots: [], queryRelations: contracts.queryRelations,
      decodeRow: (entity, input) => Result.gen(function* () {
        const row = entity === fulfillment ? yield* decodeFulfillmentCreate(input) : entity === address ? yield* decodeAddress(input)
          : entity === label ? yield* decodeLabel(input) : entity === item ? yield* decodeItem(input) : yield* Result.fail(commerceError("unsupportedProfile"));
        return { supplied: Object.fromEntries(Object.entries(row).filter(([key]) => !["location", "order"].includes(key))), key: undefined };
      }), decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")) };
    const creation: CreationProfile = { catalog, root: { entity: fulfillment, omitRelations: ["delivery_address", "items", "labels"], steps: [
      { kind: "ownedToOne", name: "delivery_address", foreignKey: "delivery_address_id", node: { entity: address, omitRelations: [], steps: [] } },
      { kind: "children", name: "labels", foreignKey: "fulfillment_id", node: { entity: label, omitRelations: [], steps: [] } },
      { kind: "children", name: "items", foreignKey: "fulfillment_id", node: { entity: item, omitRelations: [], steps: [] } },
    ] }, rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) };
    const updatePlan = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => Result.gen(function* () {
        const id = yield* decodeId(pair.entity.id), update = yield* decodeFulfillmentNativeUpdate(pair.update);
        if (update.id !== id) return yield* Result.fail(commerceError("invalidInput"));
        const supplied = "labels" in update ? { id: update.id, data: update.data } : update;
        return { key: id, update: supplied };
      }) });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner,
      shared?: Readonly<{ bridge: ReturnType<typeof commerceRepositoryContext>; events: ReturnType<typeof commerceMutationEvents> }>) => {
      const bound = scalar.bind(root, owner, shared?.events, shared?.bridge), { bridge, events } = bound, denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("FulfillmentCreation.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const suppliedOptions = isJsonObject(captured) ? captured.options : undefined;
        const options = suppliedOptions !== undefined && isJsonObject(suppliedOptions) ? suppliedOptions : undefined;
        if (options?.fields !== undefined || Array.isArray(options?.populate) && options.populate.length > 0)
          return structuredClone(yield* shipment.reads.find(ctx, captured));
        const result = yield* bound.find(ctx, input, false);
        if (result.rows.length > 1) return yield* ctx.refuse(commerceError("limitExceeded"));
        const rows: JsonObject[] = [];
        for (const value of result.rows) rows.push(yield* Effect.fromResult(contracts.fulfillment.decodeRow(projectNativeRow(value))));
        const populated = yield* populateCommerceRelations({ manager: ctx.manager, table: ctx.table, resources: ctx.resources,
          admitSelection: (table, rows) => Result.gen(function* () {
            const entity = contracts.referenceFields.find(field => field.entity.table.name === table)?.entity;
            if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
            if (rows.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
            for (const row of rows) yield* entity.decodeRow(projectNativeRow(row));
          }) }, contracts.fulfillment.table.name, rows, contracts.referenceFields.map(field => field.name), contracts.queryRelations, new Map());
        return structuredClone(populated.map(row => contracts.initializeRead(row, row)));
      });
      const create = Effect.fn("FulfillmentCreation.create")(function* (ctx: CommerceCommandContext, input: unknown,
        shared: Parameters<DAL.RepositoryService["create"]>[1]) {
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        if (!Array.isArray(input) || input.length !== 1) return yield* ctx.refuse(commerceError("unsupportedProfile"));
        const native = yield* Effect.fromResult(captureFulfillmentBusinessDates(input[0]));
        const request = yield* Effect.fromResult(decodeFulfillmentCreate(native)), captured = yield* captureGraph(creation, [native], ctx.resources), rows = new Map(captured.rows);
        const normalized: JsonObject[] = [];
        for (const row of rows.get(item.table.name) ?? []) normalized.push(yield* captureFulfillmentItemQuantity(row));
        rows.set(item.table.name, normalized);
        const inserted = yield* insertGraphRows(ctx, catalog, rows), roots = inserted.get(fulfillment.table.name) ?? [];
        const output: JsonObject[] = [];
        for (const value of roots) output.push(yield* Effect.fromResult(contracts.decodeOutput(contracts.initializeCreation(projectNativeRow(value),
          new Map([...inserted].map(([table, rows]) => [table, rows.map(projectNativeRow)])), request))));
        yield* events.created(catalog.entities.flatMap(entity => (inserted.get(entity.table.name) ?? []).map(row => ({ modelName: entity.model, entity: projectNativeRow(row) }))), shared);
        return structuredClone(output);
      });
      const update = Effect.fn("FulfillmentCreation.update")(function* (ctx: CommerceCommandContext, input: unknown,
        shared: Parameters<DAL.RepositoryService["update"]>[1]) {
        if (shared === undefined || !events.isSubscribed(shared) || !Array.isArray(input) || input.length !== 1) return yield* ctx.refuse(commerceError("unsupportedProfile"));
        const pair = input[0];
        // The native internal service owns pair construction. Normalize only
        // its declared business date, before the shared JSON/keyed boundary.
        const descriptors = yield* Effect.try({ try: () => Object.getOwnPropertyDescriptors(pair), catch: cause => commerceError("invalidInput", cause) });
        if (!descriptors.entity || !("value" in descriptors.entity) || !descriptors.update || !("value" in descriptors.update) || Reflect.ownKeys(descriptors).length !== 2)
          return yield* ctx.refuse(commerceError("invalidInput"));
        const entity = yield* Effect.fromResult(captureCommerceInput(descriptors.entity.value)), update = yield* Effect.fromResult(captureFulfillmentBusinessDates(descriptors.update.value));
        const pairs = yield* Effect.fromResult(decodePairs([{ entity, update }]));
        if (Object.hasOwn(pairs[0]!.update, "shipped_at") || Object.hasOwn(pairs[0]!.update, "delivered_at")) return yield* shipment.update(ctx, pairs[0]!, events, shared);
        const patches = yield* Effect.fromResult(updatePlan(pairs));
        const before = yield* Effect.fromResult(contracts.decodeOutput(pairs[0]!.entity));
        const supplied = patches[0]!, patch = "data" in supplied ? { ...supplied, data: selectedManualDataAssignment(before) } : supplied;
        // Native dirty tracking omits a JSON-equal empty provider assignment.
        // Keep its original create DTO detached from this update result.
        if (Object.entries(patch).every(([field, value]) => before[field] !== undefined && jsonEqual(before[field], value))) return [structuredClone(before)];
        const written = yield* (yield* ctx.table(fulfillment.table.name)).write(ctx.manager, "update", [patch]);
        yield* events.rows("afterUpdate", "Fulfillment", written.map(projectNativeRow), shared);
        // Native assign returns the selected entity and its filtered reference
        // view; no extra lookup or stored-FK rewrite occurs after the patch.
        return written.map(row => contracts.initializeRead(projectNativeRow(row), before, "assigned"));
      });
      const remove = Effect.fn("FulfillmentCreation.cleanup")(function* (ctx: CommerceCommandContext, input: unknown) {
        const selection = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodeDelete)));
        const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, "delete"),
          roots = yield* operation.roots(contracts.fulfillment.table, selection.$or.map(row => row.id)), plan = yield* operation.plan(contracts.fulfillment.table, roots);
        for (const entity of contracts.entities) if (plan.rows(entity.table).length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
        const ids: string[] = [];
        for (const row of (yield* plan.apply()).roots) ids.push(yield* Effect.fromResult(decodeId(row.id)));
        return ids;
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured))),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, create(ctx, input, shared))),
        update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, update(ctx, input, shared))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, remove(ctx, captured))),
      };
      const optionRepository: DAL.RepositoryService = { ...denied,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, returnQuery.find(ctx, captured))
          .pipe(Effect.map(rows => structuredClone(rows)))),
      };
      return { ...bound, repository, optionRepository, denied };
    };
    return { bind, contracts, catalog, creation, query: scalar.query, shipment, returnQuery };
  });
}
