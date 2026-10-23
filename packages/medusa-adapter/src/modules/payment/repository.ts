import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { commerceDecoder } from "../../value/decoder";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere } from "../../query/predicate";
import { executeRead, orderedCatalog, type ReadPlan } from "../../query/read";
import type { CommerceRelation } from "../../query/relations";
import type { capturePaymentMetadata } from "./schema";
import { compilePaymentContracts } from "./output";
import { PaymentId, PaymentSessionCreate, PaymentCollectionCreate } from "./input";

const decodeQuery = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), populate: Schema.Array(Schema.String),
  limit: Schema.optionalKey(Schema.Literals([15, 256])), offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }) }), "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject,
  update: Schema.Struct({ id: PaymentId, data: Schema.JsonObject, status: Schema.Literal("pending") }) })).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: PaymentId })).check(Schema.isLengthBetween(1, 1)) }), "unsupportedProfile");
const decodeCollectionCreates = commerceDecoder(Schema.Array(PaymentCollectionCreate).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const decodeSessionCreates = commerceDecoder(Schema.Array(PaymentSessionCreate).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const scalarProjection: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };

/** Two named repository extensions share scalar construction, one borrowed
 * manager and native event state. Other native Payment models stay denied. */
export function preparePaymentSessionRepository(metadata: Effect.Success<ReturnType<typeof capturePaymentMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compilePaymentContracts(metadata), { collection, session } = contracts;
    const collectionScalar = yield* prepareScalarRepository(collection, "PaymentCollection", scalarIdWhere);
    const sessionScalar = yield* prepareScalarRepository(session, "PaymentSession", scalarIdWhere);
    const many = collection.relationships.find(relation => relation.name === "payment_sessions");
    if (many?.type !== "hasMany" || many.targetTable !== session.name) return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map<string, Map<string, CommerceRelation>>([
      [collection.name, new Map([["payment_sessions", { name: "payment_sessions", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
        targetTable: session.name, join: { type: "hasMany", foreignKeys: ["payment_collection_id"] } }]])],
      [session.name, new Map([["payment_collection", { name: "payment_collection", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
        targetTable: collection.name, join: { type: "belongsTo", foreignKeys: ["payment_collection_id"] } }]])],
    ]);
    const catalog = yield* makeReadCatalog([collection, session].map(table => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])) })), relations);
    const query = (table: typeof collection, input: unknown) => Result.gen(function* () {
      const value = yield* decodeQuery(input), path = table === collection ? "payment_sessions" : "payment_collection";
      const paths = [...new Set([...value.options.populate, ...(value.options.fields ?? []).filter(field => field.startsWith(path + ".")).map(() => path)])];
      if (paths.some(name => name !== path)) return yield* Result.fail(commerceError("unsupportedProfile"));
      const projection = yield* compileProjection(catalog, table.name, value.options.fields, paths,
        { ...scalarProjection, allowedPaths: [path], selectableRelations: [path], nested: new Map([[path, scalarProjection]]) });
      const predicate = yield* compileWhere(value.where, scalarIdWhere);
      return { table: table.name, projection, paths, relationFilters: [], ordering: new Map(), withDeleted: false,
        query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "catalog", order: "id", select: orderedCatalog("asc") } } satisfies ReadPlan;
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const collections = collectionScalar.bind(root, owner), sessions = sessionScalar.bind(root, owner, collections.events, collections.bridge);
      const { bridge, events } = collections, denied = deniedCommerceRepository(collections.repository, collections.refuse);
      const find = (table: typeof collection, input: unknown, shared: Parameters<DAL.RepositoryService["find"]>[1], count: boolean) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const plan = yield* Effect.fromResult(query(table, captured));
          return yield* executeRead({ ...ctx, admitSelection: (name, rows) => Result.gen(function* () {
            if (rows.length > 4) return yield* Result.fail(commerceError("limitExceeded"));
            for (const row of rows) yield* (name === collection.name ? contracts.decodeCollection : contracts.decodeSession)(projectNativeRow(row));
          }) }, catalog, plan, count);
        })));
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
        owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
          const value = yield* Effect.fromResult(captureCommerceInput(input, root.resources));
          // SAFETY: native DAL's selected DTO generic is checked against complete
          // metadata projections and exact-number companions before returning.
          return (yield* contracts.present(value)) as Output;
        })));
      const readMethods = (table: typeof collection): Pick<DAL.RepositoryService, "find" | "findAndCount"> => ({
        find: async (input, shared) => structuredClone((await find(table, input, shared, false)).rows),
        findAndCount: async (input, shared) => { const value = await find(table, input, shared, true);
          return [structuredClone(value.rows), value.count ?? 0]; },
      });
      const collectionRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(collection),
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const data = yield* Effect.fromResult(decodeCollectionCreates(captured));
          const rows = [];
          for (const row of data) rows.push(yield* captureExactNumericRow(row, contracts.collectionNumbers, true));
          const inserted = yield* collections.createRows(ctx, rows, shared);
          return inserted.map(row => ({ ...row, payment_providers: [], payment_sessions: [], payments: [] }));
        }))),
      };
      const sessionRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(session),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          const data = yield* Effect.fromResult(decodeSessionCreates(captured));
          const rows = [];
          for (const row of data) rows.push(yield* captureExactNumericRow(row, contracts.sessionNumbers, true));
          return [...yield* sessions.createRows(ctx, rows, shared)];
        }))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const pairs = yield* Effect.fromResult(decodePairs(captured));
          const patches: JsonObject[] = [];
          for (const pair of pairs) {
            const entity = yield* Effect.fromResult(contracts.decodeSession(pair.entity));
            if (entity.id !== pair.update.id || entity.provider_id !== "pp_system_default") return yield* ctx.refuse(commerceError("unsupportedProfile"));
            patches.push(pair.update);
          }
          const rows = yield* (yield* ctx.table(session.name)).write(ctx.manager, "update", patches);
          for (const row of rows) yield* Effect.fromResult(contracts.decodeSession(projectNativeRow(row)));
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", "PaymentSession", [...rows], shared);
          return [...rows];
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const selection = yield* Effect.fromResult(decodeDelete(captured));
          const rows = yield* (yield* ctx.table(session.name)).delete(ctx.manager, selection.$or);
          const ids: string[] = [];
          for (const row of rows) ids.push((yield* Effect.fromResult(contracts.decodeSession(projectNativeRow(row)))).id);
          return ids;
        }))),
      };
      return { bridge, mutationEvents: collections.mutationEvents, refuse: collections.refuse, denied, collectionRepository, sessionRepository };
    };
    return { bind, contracts, catalog, query, relations };
  });
}
