import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { commerceRepositoryContext } from "./context";
import { commerceMutationEvents } from "./mutation-events";
import type { CommerceModuleEvents } from "../module/persistence";
import type { CommercePromiseOwner } from "../module/promise-owner";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../query/decoder";
import { makeReadCatalog } from "../query/catalog";
import { compileProjection } from "../query/projection";
import { compileWhere, type WherePolicy } from "../query/predicate";
import { executeRead, orderedCatalog, type ReadPlan } from "../query/read";
import type { SchemaTable } from "../schema/model";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeId = commerceDecoder(Id, "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(256)), "invalidInput");
const decodeProjection = commerceDecoder(Schema.Union([Schema.JsonObject, Schema.Array(Schema.JsonObject)]), "storedCorruption");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })),
}), "unsupportedProfile");
/** Shared scalar create/read mechanics. Module owners select checked metadata,
 * filters and explicit extensions; this factory grants no table or settlement. */
export function prepareScalarRepository(table: SchemaTable, modelName: string, wherePolicy: WherePolicy,
  normalizeProjection?: (value: Json) => Effect.Effect<Json, CommerceTransactionError>) {
  return Result.gen(function* () {
    const primary = table.columns.filter(column => column.primaryKey);
    if (primary.length !== 1 || primary[0]?.name !== "id" || primary[0].type !== "id") {
      return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const prefix = primary[0].options?.prefix;
    const columns = table.columns.map(column => column.name);
    const scalarNames = columns.filter(name => !["created_at", "updated_at", "deleted_at"].includes(name));
    const decodeCreate = commerceRowDecoder(scalarNames, "unsupportedProfile");
    const companions = Object.fromEntries(table.columns.filter(column => column.type === "bigNumber")
      .map(column => [column.name, "raw_" + column.name]));
    const catalog = yield* makeReadCatalog([{ name: table.name, columns, primaryKeys: ["id"], foreignKeys: [], companions }], new Map());
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input);
      const where = yield* decodeWhere(envelope.where ?? {});
      const options = yield* decodeOptions(envelope.options ?? {});
      const projection = yield* compileProjection(catalog, table.name, options.fields, [], {
        keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map(),
      });
      const predicate = yield* compileWhere(where, wherePolicy);
      const withDeleted = options.filters?.softDeletable.withDeleted ?? false;
      const direction = options.orderBy?.id === "DESC" ? "desc" : "asc";
      const orderCatalog = orderedCatalog(direction);
      return { table: table.name, projection, paths: [], relationFilters: [], ordering: new Map(), withDeleted,
        query: { fields: projection.storageFields, ...(options.limit === undefined ? {} : { take: options.limit }), skip: options.offset ?? 0,
          order: { column: "id", direction }, predicate: { kind: "and", children: [predicate, ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] } },
        window: options.limit === undefined
          ? { kind: "catalog", order: "id", select: rows => {
            const selected = orderCatalog(rows);
            return { rows: selected.rows.slice(options.offset ?? 0), count: selected.count };
          } }
          : { kind: "database", countAt: "afterPopulation" },
      } satisfies ReadPlan;
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner,
      sharedEvents = commerceMutationEvents(owner)) => {
      const bridge = commerceRepositoryContext(root, owner);
      const events = sharedEvents;
      const refuse = () => owner.run(root.refuse(commerceError("unsupportedProfile")));
      const find = Effect.fn("ScalarRepository.find")(function* (ctx: CommerceCommandContext, input: unknown, withCount: boolean) {
        const value = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const plan = yield* Effect.fromResult(query(value));
        return yield* executeRead(ctx, catalog, plan, withCount);
      });
      const mutationEvents: CommerceModuleEvents = {
        createEventSubscriber: events.createSubscriber, registerEventSubscriber: events.registerSubscriber,
        dispatchMutationEvent: (event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          if ((!events.isSubscribed(shared) && (subscriber === undefined || !events.ownsSubscriber(subscriber))) || event !== "afterDelete") return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.dispatch(event, args, shared, subscriber);
        }))),
      };
      const createRows = Effect.fn("ScalarRepository.create")(function* (
        ctx: CommerceCommandContext, input: unknown, shared: Parameters<DAL.RepositoryService["create"]>[1],
      ) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const rows: JsonObject[] = [];
        for (const item of yield* Effect.fromResult(decodeRows(captured))) {
          const row = yield* Effect.fromResult(decodeCreate(item));
          const id = row.id === undefined ? undefined : yield* Effect.fromResult(decodeId(row.id));
          rows.push({ ...row, id: generateEntityId(id, prefix) });
        }
        const store = yield* ctx.table(table.name);
        const inserted = yield* store.write(ctx.manager, "insert", rows);
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* events.created(inserted.map(entity => ({ modelName, entity: { ...entity } })), shared);
        return [...inserted];
      });
      const repository: DAL.RepositoryService = {
        getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
          const decoded = input === undefined ? undefined : yield* Effect.fromResult(
            captureCommerceInput(input, root.resources).pipe(Result.flatMap(decodeProjection)));
          // SAFETY: the native serializer is an identity operation and can
          // receive undefined after a zero-match scalar update. Its DAL generic
          // still declares a DTO, including for selected scalar projections.
          return (decoded === undefined || normalizeProjection === undefined
            ? decoded : yield* normalizeProjection(decoded)) as Output;
        }))),
        // Native internal services mutate entity metadata before writing. Keep
        // captured storage/projection evidence private and give DAL callers
        // detached mutable entities after the complete read is validated.
        find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, find(ctx, input, false)).pipe(Effect.map(value => structuredClone(value.rows)))),
        findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const value = yield* find(ctx, input, true);
          if (value.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [structuredClone(value.rows), value.count] satisfies [JsonObject[], number];
        }))),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, createRows(ctx, input, shared))),
        update: refuse, delete: refuse,
        upsert: refuse, upsertWithReplace: refuse, softDelete: refuse, restore: refuse,
      };
      return { repository, mutationEvents, bridge, refuse, find, createRows, events };
    };
    return { table: yield* catalog.table(table.name), bind };
  });
}
