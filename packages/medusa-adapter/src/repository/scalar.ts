import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import { planScalarCreateBatch } from "@medusajs/utils/dal/create-planning";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { compileRowProjection } from "../value/complete-row";
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
import type { decodeCompiledDml } from "../schema/compiled";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeId = commerceDecoder(Id, "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(256)), "invalidInput");
const decodeProjection = commerceDecoder(Schema.Union([Schema.JsonObject, Schema.Array(Schema.JsonObject)]), "storedCorruption");
const decodeNativePopulate = commerceDecoder(Schema.Struct({ populate: Schema.Literal(true) }), "unsupportedProfile");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })),
}), "unsupportedProfile");
export type ScalarCreationPlan = ReturnType<typeof planScalarCreateBatch<JsonObject & { id: string }>>;

/** Shared scalar create/read mechanics. Module owners select checked metadata,
 * filters and explicit extensions; this factory grants no table or settlement. */
export function prepareScalarRepository(table: SchemaTable, modelName: string, wherePolicy: WherePolicy,
  normalizeProjection?: (value: Json) => Effect.Effect<Json, CommerceTransactionError>,
  createPolicy?: { readonly managedTimestamps?: true; readonly nativeRealPresentation?: true;
    readonly nativeToOneCreationPresence?: Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number]["relationships"] },
  nativePopulate?: { readonly relationships: Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number]["relationships"] }) {
  return Result.gen(function* () {
    const primary = table.columns.filter(column => column.primaryKey);
    if (primary.length !== 1 || primary[0]?.name !== "id" || primary[0].type !== "id") {
      return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const prefix = primary[0].options?.prefix;
    const columns = table.columns.map(column => column.name);
    const populatedProjection = nativePopulate !== undefined && nativePopulate.relationships.length === 0 && table.foreignKeys.length === 0
      ? compileRowProjection(table) : Result.fail(commerceError("unsupportedProfile"));
    const scalarNames = createPolicy?.managedTimestamps ? columns : columns.filter(name => !["created_at", "updated_at", "deleted_at"].includes(name));
    const realColumns = createPolicy?.nativeRealPresentation ? table.columns.filter(column => column.type === "float").map(column => column.name) : [];
    const optionalNativeReferences: string[] = [];
    for (const relation of createPolicy?.nativeToOneCreationPresence ?? []) {
      if (relation.type !== "belongsTo" || !relation.nullable) continue;
      const name = relation.foreignKeyNames?.[0];
      const column = table.columns.find(candidate => candidate.name === name);
      const keys = table.foreignKeys.filter(key => key.columns.length === 1 && key.columns[0] === name && key.referencedTable === relation.targetTable);
      if (relation.foreignKeyNames?.length !== 1 || name === undefined || column?.nullable !== true ||
        keys.length !== 1 || keys[0]?.referencedColumns.length !== 1)
        return yield* Result.fail(commerceError("unsupportedProfile"));
      optionalNativeReferences.push(name);
    }
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
      sharedEvents = commerceMutationEvents(owner), sharedBridge?: ReturnType<typeof commerceRepositoryContext>,
      creation?: { readonly stage: (ctx: CommerceCommandContext, plan: ScalarCreationPlan,
        accept: (beforeCreatedEvents?: Effect.Effect<void, CommerceTransactionError>) => Effect.Effect<JsonObject[], CommerceTransactionError>)
        => Effect.Effect<JsonObject[], CommerceTransactionError> }) => {
      const bridge = sharedBridge ?? commerceRepositoryContext(root, owner);
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
        const rows: (JsonObject & { id: string })[] = [];
        for (const item of yield* Effect.fromResult(decodeRows(captured))) {
          const row = yield* Effect.fromResult(decodeCreate(item));
          const id = row.id === undefined ? undefined : yield* Effect.fromResult(decodeId(row.id));
          rows.push({ ...row, id: generateEntityId(id, prefix) });
        }
        const plan = planScalarCreateBatch(rows);
        let accepted = false;
        const accept = Effect.fn("ScalarRepository.acceptCreated")(function* (beforeCreatedEvents?: Effect.Effect<void, CommerceTransactionError>) {
          if (creation !== undefined) {
            if (accepted) return yield* ctx.refuse(commerceError("invalidAuthority"));
            accepted = true;
          }
          const store = yield* ctx.table(table.name);
          const inserted = yield* store.write(ctx.manager, "insert", plan.entities);
          // Native entities retain submitted REAL values until a cold read. SQL
          // conversion must succeed first; canonical storage remains untouched.
          const suppliedById = new Map(plan.entities.map(entity => [entity.id, entity]));
          const presented = inserted.map((entity, index) => {
            const result = { ...entity }, submitted = createPolicy?.nativeToOneCreationPresence === undefined
              ? plan.entities[index] : typeof entity.id === "string" ? suppliedById.get(entity.id) : undefined;
            for (const name of realColumns) if (submitted?.[name] !== undefined) result[name] = submitted[name];
            return result;
          });
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          if (beforeCreatedEvents !== undefined) yield* beforeCreatedEvents;
          yield* events.created(presented.map(entity => ({ modelName, entity: { ...entity } })), shared);
          // Existing profiles serialize the final canonical entity after every
          // input has hydrated it and storage supplied defaults and timestamps.
          if (createPolicy?.nativeToOneCreationPresence === undefined)
            return plan.positions.map(position => ({ ...presented[position]! }));
          // Native nullable belongsTo fields have no scalar default setter. An
          // omitted reference remains absent on the immediate entity even when
          // its complete stored row contains NULL. Keep mutation evidence full;
          // only detached return presentation follows canonical input presence.
          const returned = new Map<string, JsonObject>();
          for (const entity of presented) {
            const result = { ...entity }, submitted = typeof entity.id === "string" ? suppliedById.get(entity.id) : undefined;
            if (submitted === undefined || returned.has(submitted.id)) return yield* ctx.refuse(commerceError("storedCorruption"));
            for (const name of optionalNativeReferences) if (submitted[name] === undefined) delete result[name];
            returned.set(submitted.id, result);
          }
          if (returned.size !== plan.entities.length) return yield* ctx.refuse(commerceError("storedCorruption"));
          return plan.created.map(entity => structuredClone(returned.get(entity.id)!));
        });
        return creation === undefined ? yield* accept()
          : yield* creation.stage(ctx, plan, accept);
      });
      const repository: DAL.RepositoryService = {
        getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(bridge.checked(root, Effect.gen(function* () {
          const projection = options === undefined ? undefined : yield* Effect.fromResult(Result.gen(function* () {
            let omitted = false;
            const captured = yield* captureCommerceInput(options, root.resources, () => { omitted = true; });
            if (omitted) return yield* Result.fail(commerceError("unsupportedProfile"));
            yield* decodeNativePopulate(captured);
            return yield* populatedProjection;
          }));
          const decoded = input === undefined ? undefined : yield* Effect.fromResult(
            captureCommerceInput(input, root.resources).pipe(Result.flatMap(decodeProjection)));
          if (projection !== undefined && decoded !== undefined)
            for (const row of Array.isArray(decoded) ? decoded : [decoded]) yield* Effect.fromResult(projection(row));
          // SAFETY: the native serializer is an identity operation and can
          // receive undefined after a zero-match scalar update. Its DAL generic
          // still declares a DTO, including for selected scalar projections.
          const output = decoded === undefined || normalizeProjection === undefined
            ? decoded : yield* normalizeProjection(decoded);
          // Native populate serializers hand mutable DTOs to module formatters.
          // Keep the bounded private capture separate from those mutations.
          return (projection === undefined || output === undefined ? output : structuredClone(output)) as Output;
        }))),
        // Native internal services mutate entity metadata before writing. Keep
        // captured storage/projection evidence private and give DAL callers
        // detached mutable entities after the complete read is validated.
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured, false)).pipe(Effect.map(value => structuredClone(value.rows)))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const value = yield* find(ctx, captured, true);
          if (value.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [structuredClone(value.rows), value.count] satisfies [JsonObject[], number];
        }))),
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, createRows(ctx, captured, shared))),
        update: refuse, delete: refuse,
        upsert: refuse, upsertWithReplace: refuse, softDelete: refuse, restore: refuse,
      };
      return { repository, mutationEvents, bridge, refuse, find, createRows, events };
    };
    return { table: yield* catalog.table(table.name), query, bind };
  });
}
