import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { orderNativeIdRows } from "../../repository/result";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere } from "../../query/predicate";
import { executeRead } from "../../query/read";
import { QueryEnvelope } from "../../query/decoder";
import type { ReplacementProfile } from "../../write/graph-model";
import { replaceGraphRows } from "../../write/replace";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { captureStoreMetadata } from "./schema";
import { prepareStoreGraph } from "./graph";
import { compileStoreUpdateContracts, StoreUpdateUpsert, CurrencyPreimage, LocalePreimage } from "./update-input";

type Metadata = Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"];
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
  populate: Schema.optionalKey(Schema.Array(Schema.Literals(["supported_currencies", "supported_locales"])).check(Schema.isMaxLength(2))),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })),
}), "unsupportedProfile");
const decodeReplacement = commerceDecoder(Schema.Struct({ input: Schema.Array(StoreUpdateUpsert).check(Schema.isMaxLength(4)),
  config: Schema.Struct({ relations: Schema.Tuple([Schema.Literal("supported_currencies"), Schema.Literal("supported_locales")]) }),
}), "unsupportedProfile");
const decodeActions = commerceDecoder(Schema.Struct({
  created: Schema.Struct({ StoreCurrency: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))),
    StoreLocale: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))) }),
  updated: Schema.Struct({ Store: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))),
    StoreCurrency: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))), StoreLocale: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))) }),
  deleted: Schema.Struct({ StoreCurrency: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))),
    StoreLocale: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))) }),
}), "storedCorruption");
const childProjection: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", incomingKeys: true,
  selectableRelations: [], nested: new Map() };

/** Native Store selector list and existing-root replacement only. Aggregate
 * historical children are admitted before any graph write; shared graph/core
 * owners retain replacement, managed-field and reconstitution enforcement. */
export function prepareStoreUpdateRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileStoreUpdateContracts(metadata), { creation } = contracts, { lifecycle } = creation;
    const decodeStore = commerceDecoder(StoreUpdateUpsert, "invalidInput"), decodeCurrency = commerceDecoder(CurrencyPreimage, "invalidInput"),
      decodeLocale = commerceDecoder(LocalePreimage, "invalidInput");
    const graph = yield* prepareStoreGraph(creation, (entity, input) => Result.gen(function* () {
      const supplied = entity.table === lifecycle.store ? yield* decodeStore(input)
        : entity.table === lifecycle.currency ? yield* decodeCurrency(input)
          : entity.table === lifecycle.locale ? yield* decodeLocale(input)
            : yield* Result.fail(commerceError("unsupportedProfile"));
      return { supplied, key: typeof supplied.id === "string" ? supplied.id : undefined };
    }));
    const tables = lifecycle.entities.map(entity => ({ name: entity.table.name, columns: entity.table.columns.map(column => column.name),
      primaryKeys: ["id"], foreignKeys: entity.table.foreignKeys.flatMap(key => key.columns), companions: {} }));
    const catalog = yield* makeReadCatalog(tables, graph.catalog.queryRelations);
    const table = yield* catalog.table(lifecycle.store.name), currency = yield* catalog.table(lifecycle.currency.name), locale = yield* catalog.table(lifecycle.locale.name);
    const read = { table, paths: [{ path: "supported_currencies", table: currency, many: true }, { path: "supported_locales", table: locale, many: true }] };
    const projection: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: ["supported_currencies", "supported_locales"],
      allowedPaths: ["supported_currencies", "supported_locales"], nested: new Map([["supported_currencies", childProjection], ["supported_locales", childProjection]]) };
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input), where = yield* decodeWhere(envelope.where ?? {}), options = yield* decodeOptions(envelope.options ?? {});
      const fields = yield* compileProjection(catalog, table.name, options.fields, options.populate ?? [], projection);
      const predicate = yield* compileWhere(where, scalarIdWhere);
      return { where, fields, predicate, paths: options.populate ?? [] };
    });
    const prepared = yield* prepareScalarRepository(lifecycle.store, "Store", scalarIdWhere);
    const profile: ReplacementProfile = { catalog: graph.catalog, allowReconstitution: true,
      allowedRelations: entity => entity === graph.store ? ["supported_currencies", "supported_locales"] : [],
      ownedToOne: () => [], mutableForeignKeys: () => false, admitSelection: graph.admitSelection,
      prepareProjection: (_entity, roots, load) => Effect.gen(function* () {
        const ids = roots.flatMap(row => typeof row.id === "string" ? [row.id] : []);
        for (const child of lifecycle.entities.filter(entity => entity.table !== lifecycle.store)) {
          const rows = yield* load(child.table, "store_id", ids);
          // The graph view includes planned DTOs before core applies managed
          // defaults. Actual storage rows were decoded at preload and load.
          if (rows.length > child.maximum) return yield* Effect.fail(commerceError("limitExceeded"));
          for (const id of ids) if (rows.filter(row => row.store_id === id && row.deleted_at == null).length > 2)
            return yield* Effect.fail(commerceError("limitExceeded"));
        }
      }),
      toManyMode: (entity, name, child) => entity === graph.store && graph.relations.get(name)?.targetTable === child.table.name
        ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
      validateLink: () => Effect.fail(commerceError("unsupportedProfile")),
      projectionPaths: (_entity, names) => names,
      project: rows => Result.succeed(new Map([...rows].map(([table, rows]) => [table, rows.filter(row => row.deleted_at === null)]))),
    };
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const admitSelection = (table: string, rows: readonly JsonObject[]) => {
        const entity = lifecycle.entities.find(entity => entity.table.name === table);
        return entity === undefined ? Result.fail(commerceError("unsupportedProfile")) : graph.admitSelection(entity.table, rows);
      };
      const find = Effect.fn("StoreUpdate.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources)), plan = yield* Effect.fromResult(query(captured));
        const result = yield* executeRead({ ...ctx, admitSelection }, catalog, { table: table.name, projection: plan.fields, paths: plan.paths,
          relationFilters: [], ordering: new Map(), withDeleted: false,
          query: { fields: plan.fields.storageFields, order: { column: "id", direction: "asc" },
            predicate: { kind: "and", children: [plan.predicate, { kind: "isNull", column: "deleted_at" }] } },
          window: { kind: "catalog", order: "id", select: rows => {
            const keyed = rows.flatMap((row): Array<JsonObject & { readonly id: string }> => typeof row.id === "string" ? [{ ...row, id: row.id }] : []);
            return { rows: orderNativeIdRows(keyed, plan.where), count: rows.length };
          } },
        }, false);
        return yield* Effect.fromResult(contracts.decodePreimages(result.rows));
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, find(ctx, value)).pipe(Effect.map(rows => structuredClone([...rows])))),
        upsertWithReplace: (input, config, shared) => bridge.executeInput(shared, { input, config }, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources)), args = yield* Effect.fromResult(decodeReplacement(captured));
          const ids = args.input.map(row => row.id);
          if (new Set(ids).size !== ids.length) return yield* ctx.refuse(commerceError("invalidInput"));
          if (ids.length) for (const entity of lifecycle.entities) {
            const store = yield* ctx.table(entity.table.name);
            const rows = yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: "id", direction: "asc" },
              predicate: { kind: "in", column: entity.table === lifecycle.store ? "id" : "store_id", values: ids } });
            yield* Effect.fromResult(graph.admitSelection(entity.table, rows));
            if (entity.table === lifecycle.store && (rows.length !== ids.length || rows.some(row => row.deleted_at !== null)))
              return yield* ctx.refuse(commerceError("invalidInput"));
          }
          const result = yield* replaceGraphRows(ctx, profile, graph.store, args.input, args.config);
          const entities = yield* Effect.fromResult(creation.decodeRows(result.entities));
          const decodedActions = yield* Effect.fromResult(decodeActions(result.performedActions));
          const mutableActions = (actions: Readonly<Record<string, readonly { readonly id: string }[] | undefined>>) => {
            const result: Record<string, { id: string }[]> = {};
            for (const [model, members] of Object.entries(actions)) if (members !== undefined) result[model] = members.map(member => ({ id: member.id }));
            return result;
          };
          const performedActions = { created: mutableActions(decodedActions.created), updated: mutableActions(decodedActions.updated), deleted: mutableActions(decodedActions.deleted) };
          return { entities: structuredClone([...entities]), performedActions };
        }))),
      };
      const mutationEvents = { ...bound.mutationEvents,
        dispatchMutationEvent: ((event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          if ((!events.isSubscribed(shared) && (subscriber === undefined || !events.ownsSubscriber(subscriber))) ||
            event !== "afterCreate" && event !== "afterUpdate" && event !== "afterDelete") return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.dispatch(event, args, shared, subscriber);
        })))) satisfies NonNullable<typeof bound.mutationEvents.dispatchMutationEvent>,
      };
      return { ...bound, repository, denied, mutationEvents };
    };
    return { bind, contracts, read, query, catalog, graph };
  });
}
