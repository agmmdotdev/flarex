import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import type { CommerceModuleEvents } from "./commerce-module";
import { commerceRepositoryContext } from "./commerce-repository-context";
import { commerceMutationEvents } from "./commerce-mutation-events";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { encodeExactNumeric, decodeExactNumeric } from "./exact-numeric";
import { captureGraph, insertGraphRows } from "./write/create";
import type { GraphCatalog, GraphEntity, CreationProfile } from "./write/graph-model";
import { makeReadCatalog } from "./query/catalog";
import { compileProjection, type ProjectionPolicy } from "./query/projection";
import { compileWhere, type WherePolicy } from "./query/predicate";
import { compilePopulationWhere, isSelectedPopulationPath } from "./query/population";
import { executeRead, orderedCatalog, type ReadPlan } from "./query/read";
import { QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";
import { PricingId } from "./pricing-input";
import type { capturePricingMetadata } from "./pricing-schema";
import { relationPaths } from "./local-graph/module";

const Numeric = Schema.Union([Schema.String, Schema.Number]);
const Rule = Schema.Struct({ id: Schema.optionalKey(PricingId), attribute: Schema.String, value: Schema.String,
  priority: Schema.optionalKey(Schema.Literal(0)), operator: Schema.optionalKey(Schema.Literal("eq")),
});
const Price = Schema.Struct({ id: Schema.optionalKey(PricingId), title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  currency_code: Schema.String, amount: Numeric,
  min_quantity: Schema.optionalKey(Schema.NullOr(Numeric)), max_quantity: Schema.optionalKey(Schema.NullOr(Numeric)),
  rules_count: Schema.optionalKey(Schema.Literals([0, 1])), price_rules: Schema.optionalKey(Schema.Array(Rule).check(Schema.isMaxLength(1))),
});
const SetInput = Schema.Struct({ id: Schema.optionalKey(PricingId), prices: Schema.Array(Price).check(Schema.isMaxLength(2)) });
const decodeSet = commerceDecoder(SetInput, "unsupportedProfile");
const decodePrice = commerceDecoder(Price, "unsupportedProfile");
const decodeRule = commerceDecoder(Rule, "unsupportedProfile");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeStoredRows = commerceDecoder(Schema.Array(Schema.JsonObject), "storedCorruption");
const decodeSerialized = commerceDecoder(Schema.Union([Schema.JsonObject, Schema.Array(Schema.JsonObject)]), "storedCorruption");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  populate: Schema.optionalKey(Schema.Array(Schema.Literals(["prices", "prices.price_rules"])).check(Schema.isMaxLength(2))),
  populateWhere: Schema.optionalKey(Schema.Struct({ prices: Schema.Struct({ price_list_id: Schema.Null }) })),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })),
}), "unsupportedProfile");
const ids = commerceDecoder(Schema.Union([PricingId, Schema.Array(PricingId).check(Schema.isMaxLength(256))]), "unsupportedProfile");
const where: WherePolicy = { decode: commerceDecoder(Schema.JsonObject, "unsupportedProfile"),
  fields: new Map([["id", { column: "id", decode: ids }]]),
  selectors: { mode: "membership", key: "id", decode: commerceDecoder(Schema.Array(Schema.Struct({ id: PricingId })).check(Schema.isMaxLength(256)), "unsupportedProfile") },
};
const childWhere: WherePolicy = { decode: commerceDecoder(Schema.Struct({ price_list_id: Schema.Null }), "unsupportedProfile"),
  fields: new Map([["price_list_id", { column: "price_list_id", decode: commerceDecoder(Schema.Null, "unsupportedProfile") }]]),
};
const paths = ["prices", "prices.price_rules"];
const scalarProjection: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
const priceProjection: ProjectionPolicy = { ...scalarProjection, allowedPaths: ["price_rules"], selectableRelations: ["price_rules"], nested: new Map([["price_rules", scalarProjection]]) };
const projectionPolicy: ProjectionPolicy = { ...scalarProjection, allowedPaths: paths, selectableRelations: ["prices"], nested: new Map([["prices", priceProjection]]) };

/** Pricing owns the finite nested creation policy; shared graph/read owners
 * retain traversal, scoped persistence and native mutation dispatch. */
export function preparePricingRepository(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const entities: GraphEntity[] = [];
    for (const [name, model] of [["price_set", "PriceSet"], ["price", "Price"], ["price_rule", "PriceRule"]] as const) {
      const table = metadata.tables.find(item => item.name === name);
      const key = table?.columns.find(column => column.primaryKey);
      if (table === undefined || key?.type !== "id" || key.name !== "id") return yield* Result.fail(commerceError("unsupportedProfile"));
      entities.push({ table, model, keyColumn: key.name, prefix: key.options?.prefix });
    }
    const [set, price, rule] = entities;
    if (!set || !price || !rule) return yield* Result.fail(commerceError("unsupportedProfile"));
    const setTable = metadata.tables.find(table => table.name === set.table.name);
    const priceTable = metadata.tables.find(table => table.name === price.table.name);
    if (!setTable || !priceTable) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prices = describeToManyRelation(setTable, "prices", metadata.tables);
    const rules = describeToManyRelation(priceTable, "price_rules", metadata.tables);
    if (prices?.join.type !== "hasMany" || rules?.join.type !== "hasMany" || prices.join.foreignKeys.length !== 1 || rules.join.foreignKeys.length !== 1) return yield* Result.fail(commerceError("unsupportedProfile"));
    const priceForeignKey = prices.join.foreignKeys[0], ruleForeignKey = rules.join.foreignKeys[0];
    if (!priceForeignKey || !ruleForeignKey) return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map([[set.table.name, new Map([["prices", prices]])], [price.table.name, new Map([["price_rules", rules]])]]);
    const readCatalog = yield* makeReadCatalog(entities.map(entity => ({ name: entity.table.name,
      columns: entity.table.columns.map(column => column.name), primaryKeys: [entity.keyColumn],
      foreignKeys: entity.table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(entity.table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])),
    })), relations);
    const catalog: GraphCatalog = { entities, tables: entities.map(entity => entity.table), writablePivots: [], queryRelations: relations,
      decodeRow: (entity, input) => Result.gen(function* () {
        const supplied = entity === set ? yield* decodeSet(input) : entity === price ? yield* decodePrice(input) : yield* decodeRule(input);
        return { supplied, key: supplied.id };
      }),
      decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
    };
    const creation: CreationProfile = { catalog, root: { entity: set, omitRelations: ["prices"], steps: [
      { kind: "children", name: "prices", foreignKey: priceForeignKey, node: { entity: price, omitRelations: ["price_rules"], steps: [
        { kind: "children", name: "price_rules", foreignKey: ruleForeignKey, node: { entity: rule, omitRelations: [], steps: [] } },
      ] } },
    ] }, rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) };
    const query = (input: unknown) => Result.gen(function* () {
      const envelope = yield* decodeEnvelope(input);
      const options = yield* decodeOptions(envelope.options ?? {});
      const selectedPaths = options.populate ?? [];
      const projection = yield* compileProjection(readCatalog, set.table.name, options.fields, selectedPaths, projectionPolicy);
      // Native normalization supplies this option even for a root-only read.
      // Validate its entire grammar, then activate only selected child paths.
      const population = yield* compilePopulationWhere(readCatalog, set.table.name, paths, options.populateWhere, new Map([["prices", childWhere]]));
      const predicate = yield* compileWhere(envelope.where ?? {}, where);
      const withDeleted = options.filters?.softDeletable.withDeleted ?? false;
      const direction = options.orderBy?.id === "DESC" ? "desc" : "asc";
      const ordered = orderedCatalog(direction);
      return { table: set.table.name, projection, paths: selectedPaths, relationFilters: [], ordering: new Map(), withDeleted,
        populationFilters: population.filter(filter => isSelectedPopulationPath(filter.path, selectedPaths)),
        query: { fields: projection.storageFields, ...(options.limit === undefined ? {} : { take: options.limit }), skip: options.offset ?? 0,
          order: { column: "id", direction }, predicate: { kind: "and", children: [predicate, ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] } },
        window: options.limit === undefined ? { kind: "catalog", order: "id", select: rows => {
          const selected = ordered(rows); return { rows: selected.rows.slice(options.offset ?? 0), count: selected.count };
        } } : { kind: "database", countAt: "afterPopulation" },
      } satisfies ReadPlan;
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bridge = commerceRepositoryContext(root, owner), events = commerceMutationEvents(owner);
      const refuse = () => owner.run(root.refuse(commerceError("unsupportedProfile")));
      const mutationEvents: CommerceModuleEvents = { createEventSubscriber: events.createSubscriber, registerEventSubscriber: events.registerSubscriber,
        dispatchMutationEvent: (event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          if ((!events.isSubscribed(shared) && (subscriber === undefined || !events.ownsSubscriber(subscriber))) || event !== "afterDelete") return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.dispatch(event, args, shared, subscriber);
        }))),
      };
      const find = Effect.fn("PricingRepository.find")(function* (ctx: CommerceCommandContext, input: unknown, count: boolean) {
        const plan = yield* Effect.fromResult(query(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        const result = yield* executeRead(ctx, readCatalog, plan, count);
        // Convert selected exact pairs once, before native serialization can
        // reread the same detached rows. Raw companions retain native metadata.
        const output: JsonObject[] = [];
        for (const row of result.rows) {
          const children = row.prices;
          if (children === undefined) { output.push(row); continue; }
          const decoded = yield* Effect.fromResult(decodeStoredRows(children));
          const prices: JsonObject[] = [];
          for (const stored of decoded) {
            const child = { ...stored };
            for (const column of price.table.columns) if (column.type === "bigNumber" && Object.hasOwn(child, column.name)) {
              child[column.name] = yield* decodeExactNumeric(child[column.name], child["raw_" + column.name], column.nullable);
            }
            prices.push(child);
          }
          output.push({ ...row, prices });
        }
        return { ...result, rows: output };
      });
      const repository: DAL.RepositoryService = {
        getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
          const value = yield* Effect.fromResult(captureCommerceInput(input, root.resources));
          const decoded = yield* Effect.fromResult(decodeSerialized(value));
          // SAFETY: the native DAL generic also covers partial projections;
          // graph rows and selected scalar values were validated above.
          return decoded as Output;
        }))),
        find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, find(ctx, input, false)).pipe(Effect.map(value => value.rows))),
        findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const value = yield* find(ctx, input, true);
          if (value.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [value.rows, value.count] satisfies [JsonObject[], number];
        }))),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const graph = yield* captureGraph(creation, input, ctx.resources);
          const rows = new Map(graph.rows);
          const values: JsonObject[] = [];
          for (const inputRow of rows.get(price.table.name) ?? []) {
            const row = { ...inputRow };
            for (const column of price.table.columns) if (column.type === "bigNumber") {
              const value = row[column.name];
              if ((value === undefined || value === null) && column.nullable) { row[column.name] = null; row["raw_" + column.name] = null; }
              else { const encoded = yield* encodeExactNumeric(value); row[column.name] = encoded.value; row["raw_" + column.name] = yield* Effect.fromResult(captureCommerceInput(encoded.raw, ctx.resources)); }
            }
            values.push(row);
          }
          rows.set(price.table.name, values);
          const inserted = yield* insertGraphRows(ctx, catalog, rows);
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.created(entities.flatMap(entity => (inserted.get(entity.table.name) ?? []).map(row => ({ modelName: entity.model, entity: { ...row } }))), shared);
          return [...inserted.get(set.table.name) ?? []];
        }))),
        update: refuse, delete: refuse, upsert: refuse, upsertWithReplace: refuse, softDelete: refuse, restore: refuse,
      };
      const denied: DAL.RepositoryService = { ...repository, serialize: refuse, find: refuse, findAndCount: refuse, create: refuse };
      return { repository, denied, mutationEvents, bridge, refuse };
    };
    return { bind, table: yield* readCatalog.table(set.table.name), paths: yield* relationPaths(readCatalog, set.table.name, paths) };
  });
}
