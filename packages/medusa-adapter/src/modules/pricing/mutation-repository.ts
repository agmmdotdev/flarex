import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureExactNumericUpdatePair, projectExactNumericColumns, encodeExactNumeric } from "../../value/exact-numeric";
import { compileKeyedUpdates } from "../../write/keyed";
import type { CreationProfile, GraphCatalog, GraphEntity } from "../../write/graph-model";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { executeRead, orderedCatalog, type ReadPlan } from "../../query/read";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import { readCommerceRelationRows } from "../../query/relations";
import { PricingId } from "./input";
import { ShippingNormalizedMutationRule, decodeShippingNormalizedPriceCreate } from "./shipping-input";
import type { commerceRepositoryContext } from "../../repository/context";
import type { commerceMutationEvents } from "../../repository/mutation-events";

const Numeric = Schema.Union([Schema.String, Schema.Number]);
const Rule = Schema.Struct({ id: Schema.optionalKey(PricingId), price_id: Schema.optionalKey(PricingId),
  attribute: Schema.String, value: Schema.String, priority: Schema.optionalKey(Schema.Literal(0)),
  operator: Schema.optionalKey(Schema.Literal("eq")) });
const Price = Schema.Struct({ id: Schema.optionalKey(PricingId), price_set_id: PricingId,
  price_list_id: Schema.optionalKey(Schema.Null), title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  currency_code: Schema.String, amount: Numeric, min_quantity: Schema.optionalKey(Schema.NullOr(Numeric)),
  max_quantity: Schema.optionalKey(Schema.NullOr(Numeric)), rules_count: Schema.optionalKey(Schema.Literals([0, 1])),
  price_rules: Schema.optionalKey(Schema.Array(Rule).check(Schema.isMaxLength(1))) });
const decodePrice = commerceDecoder(Price, "unsupportedProfile"), decodeRule = commerceDecoder(Rule, "unsupportedProfile");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
  .check(Schema.isMaxLength(8)), "unsupportedProfile");
const decodePair = commerceDecoder(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }), "unsupportedProfile");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: PricingId }))
  .check(Schema.isMaxLength(8)) }), "unsupportedProfile");
const decodeIds = commerceDecoder(Schema.Union([PricingId, Schema.Array(PricingId).check(Schema.isMaxLength(8))]), "unsupportedProfile");
const decodeId = commerceDecoder(PricingId, "storedCorruption");
const scalarProjection: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };

/** Physical Price removal owns its complete Rule history. Base-price and
 * workflow profiles share this inverse; each retains its own selector grammar
 * and total resource bound rather than a forward Rule count. */
export const deletePricingPriceRows = Effect.fn("PricingRepository.deletePrices")(function* (
  ctx: CommerceCommandContext, price: GraphEntity, rule: GraphEntity,
  selected: Readonly<{ $or: readonly Readonly<{ id: string }>[] }>, ruleLimit: number, rootOrder?: "storageInsertion",
) {
  const children = yield* readCommerceRelationRows(ctx, rule.table.name,
    { kind: "in", column: "price_id", values: selected.$or.map(row => row.id) });
  if (children.length > ruleLimit) return yield* ctx.refuse(commerceError("limitExceeded"));
  // The native selector is an OR predicate. Repeated alternatives still select
  // one stored row; the core's write batch accepts each identity exactly once.
  const ids = [...new Set(selected.$or.map(row => row.id))];
  const identities = rootOrder === undefined ? ids.map(id => ({ id })) : yield* Effect.forEach(
    yield* readCommerceRelationRows(ctx, price.table.name, { kind: "in", column: "id", values: ids }, { kind: "storageInsertion", direction: "asc" }),
    row => Effect.fromResult(decodeId(row.id)).pipe(Effect.map(id => ({ id }))),
  );
  yield* (yield* ctx.table(rule.table.name)).delete(ctx.manager, children.map(row => ({ id: row.id })));
  const deleted = yield* (yield* ctx.table(price.table.name)).delete(ctx.manager, identities);
  const deletedIds: string[] = [];
  for (const row of deleted) deletedIds.push(yield* Effect.fromResult(decodeId(row.id)));
  return deletedIds;
});

/** Pricing's normalized base-price mutations. Native services own replacement
 * decisions; shared readers, graph insertion, keyed writes and events execute them. */
export function preparePricingMutations(catalog: GraphCatalog, price: GraphEntity, rule: GraphEntity, cascadeRules: boolean, shipping = false) {
  return Result.gen(function* () {
    const ruleLimit = shipping ? 24 : 8;
    const emptyRules = commerceDecoder(Schema.Record(Schema.String, Schema.Never), "unsupportedProfile");
    const selectedPrice = shipping ? decodeShippingNormalizedPriceCreate : decodePrice;
    const selectedRule = shipping ? commerceDecoder(ShippingNormalizedMutationRule, "unsupportedProfile") : decodeRule;
    const selectedPairs = shipping ? commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject }))
      .check(Schema.isMaxLength(24)), "unsupportedProfile") : decodePairs;
    const selectedDelete = shipping ? commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: PricingId }))
      .check(Schema.isMaxLength(24)) }), "unsupportedProfile") : decodeDelete;
    const selectedIds = shipping ? commerceDecoder(Schema.Union([PricingId, Schema.Array(PricingId).check(Schema.isMaxLength(24))]), "unsupportedProfile") : decodeIds;
    const ruleForeign = rule.table.foreignKeys.find(key => key.referencedTable === price.table.name);
    if (!(ruleForeign?.onDelete === "cascade" || cascadeRules)
      || ruleForeign === undefined || ruleForeign.columns.length !== 1 || ruleForeign.columns[0] !== "price_id"
      || ruleForeign.referencedColumns.length !== 1 || ruleForeign.referencedColumns[0] !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const mutationCatalog: GraphCatalog = { ...catalog, decodeRow: (entity, input) => Result.gen(function* () {
      const supplied = entity === price ? yield* selectedPrice(input) : entity === rule ? yield* selectedRule(input)
        : yield* Result.fail(commerceError("unsupportedProfile"));
      return { supplied, key: supplied.id };
    }) };
    const creation: CreationProfile = { catalog: mutationCatalog, root: { entity: price, omitRelations: shipping ? ["price_rules", "rules", "price_list"] : ["price_rules"],
      steps: [{ kind: "children", name: "price_rules", foreignKey: ruleForeign.columns[0],
        node: { entity: rule, omitRelations: [], steps: [] } }] },
      rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) };
    const ruleCreation: CreationProfile = { ...creation, root: { entity: rule, omitRelations: [], steps: [] } };
    const readCatalog = yield* makeReadCatalog([price, rule].map(entity => ({ name: entity.table.name,
      columns: entity.table.columns.map(column => column.name), primaryKeys: ["id"],
      foreignKeys: entity.table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(entity.table.columns.filter(column => column.type === "bigNumber")
        .map(column => [column.name, "raw_" + column.name])) })), new Map([[price.table.name, catalog.queryRelations.get(price.table.name) ?? new Map()]]));
    const policies = new Map([price, rule].map(entity => [entity, { decode: commerceDecoder(Schema.JsonObject, "unsupportedProfile"),
      fields: new Map([["id", { column: "id", decode: entity === rule ? selectedIds : decodeIds }],
        [entity === price ? "price_set_id" : "price_id", { column: entity === price ? "price_set_id" : "price_id", decode: entity === rule ? selectedIds : decodeIds }],
        ...(entity === price ? [["price_list_id", { column: "price_list_id", decode: commerceDecoder(Schema.Null, "unsupportedProfile") }] as const] : [])]),
      selectors: { mode: "membership", key: "id", decode: commerceDecoder(Schema.Array(Schema.Struct({ id: PricingId }))
        .check(Schema.isMaxLength(entity === rule ? ruleLimit : 8)), "unsupportedProfile") } } satisfies WherePolicy]));
    const options = commerceDecoder(Schema.Struct({ fields: Schema.optionalKey(Schema.Array(Schema.String)),
      populate: Schema.optionalKey(Schema.Array(Schema.Literal("price_rules")).check(Schema.isMaxLength(1))),
      limit: Schema.optionalKey(Schema.NullOr(QueryLimit)), offset: Schema.optionalKey(QueryOffset),
      orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
      filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })) }), "unsupportedProfile");
    const plans = new Map([price, rule].map(entity => {
      const numeric = entity.table.columns.filter(column => column.type === "bigNumber");
      const fields = entity.table.columns.map(column => column.name).filter(name => !["created_at", "updated_at", "deleted_at"].includes(name));
      const decodeUpdate = commerceRowDecoder(fields, "unsupportedProfile");
      return [entity, { numeric, plan: compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "preserve", decodeEntries: entity === rule ? selectedPairs : decodePairs,
        readEntry: pair => Result.gen(function* () {
          const id = yield* decodeId(pair.entity.id);
          const update = { ...pair.update };
          if (shipping) {
            for (const name of ["created_at", "updated_at", "deleted_at"]) {
              if (name !== "updated_at" && update[name] !== undefined && update[name] !== pair.entity[name]) return yield* Result.fail(commerceError("invalidInput"));
              delete update[name];
            }
            if (entity === price && update.price_list === null) delete update.price_list;
            if (entity === price && update.rules !== undefined) { yield* emptyRules(update.rules); delete update.rules; }
          }
          yield* decodeUpdate(Object.fromEntries(Object.entries(update).filter(([name]) => !numeric.some(column => name === "raw_" + column.name))));
          return { key: id, update };
        }) }) }] as const;
    }));
    const queryPlan = (table: string, input: unknown) => Result.gen(function* () {
      const entity = table === price.table.name ? price : table === rule.table.name ? rule : undefined;
      if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const envelope = yield* decodeEnvelope(input), config = yield* options(envelope.options ?? {});
      const paths = config.populate ?? [];
      if (entity === rule && paths.length) return yield* Result.fail(commerceError("unsupportedProfile"));
      const projection = yield* compileProjection(readCatalog, entity.table.name, config.fields, paths,
        entity === price ? { ...scalarProjection, allowedPaths: ["price_rules"], selectableRelations: ["price_rules"], nested: new Map([["price_rules", scalarProjection]]) } : scalarProjection);
      const policy = policies.get(entity);
      if (policy === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const predicate = yield* compileWhere(envelope.where ?? {}, policy);
      const direction = config.orderBy?.id === "DESC" ? "desc" : "asc", ordered = orderedCatalog(direction);
      return { table: entity.table.name, projection, paths, relationFilters: [], ordering: new Map(), withDeleted: config.filters?.softDeletable.withDeleted ?? false,
        query: { fields: projection.storageFields, skip: config.offset ?? 0, ...(config.limit === undefined || config.limit === null ? {} : { take: config.limit }),
          order: { column: "id", direction }, predicate: { kind: "and", children: [predicate, ...(config.filters?.softDeletable.withDeleted ? [] : [{ kind: "isNull" as const, column: "deleted_at" }])] } },
        window: config.limit === undefined || config.limit === null ? { kind: "catalog", order: "id", select: rows => {
          const values = ordered(rows); return { rows: values.rows.slice(config.offset ?? 0), count: values.count };
        } } : { kind: "database", countAt: "afterPopulation" } } satisfies ReadPlan;
    });
    const bind = (bridge: ReturnType<typeof commerceRepositoryContext>, events: ReturnType<typeof commerceMutationEvents>,
      base: DAL.RepositoryService,
      create: (ctx: CommerceCommandContext, profile: CreationProfile, input: unknown, shared: Parameters<DAL.RepositoryService["create"]>[1]) => Effect.Effect<JsonObject[], ReturnType<typeof commerceError>>,
      findTaxRules: (ctx: CommerceCommandContext, input: unknown) => Effect.Effect<JsonObject[], ReturnType<typeof commerceError>>,
    ) => {
      const repository = (entity: GraphEntity): DAL.RepositoryService => ({ ...base,
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, create(ctx, entity === price ? creation : ruleCreation, input, shared))),
        find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const query = yield* Effect.fromResult(decodeEnvelope(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
          if (entity === rule && Object.hasOwn(query.where ?? {}, "price_id")) {
            const rows = yield* findTaxRules(ctx, query);
            if (shipping && rows.length > ruleLimit) return yield* ctx.refuse(commerceError("limitExceeded"));
            return rows;
          }
          const plan = yield* Effect.fromResult(queryPlan(entity.table.name, query));
          const result = yield* executeRead(ctx, readCatalog, plan, false);
          if (result.rows.length > (entity === rule ? ruleLimit : 8)) return yield* ctx.refuse(commerceError("limitExceeded"));
          if (entity === price) {
            const sets = new Map<string, number>();
            let rules = 0;
            for (const row of result.rows) {
              if (typeof row.price_set_id === "string" && row.price_list_id === null) {
                const count = (sets.get(row.price_set_id) ?? 0) + 1; sets.set(row.price_set_id, count);
                if (count > 2) return yield* ctx.refuse(commerceError("limitExceeded"));
              }
              if (Array.isArray(row.price_rules)) {
                rules += row.price_rules.length;
                if (row.price_rules.length > (shipping ? 24 : 1)) return yield* ctx.refuse(commerceError("limitExceeded"));
              }
            }
            if (shipping && rules > ruleLimit) return yield* ctx.refuse(commerceError("limitExceeded"));
          }
          return structuredClone([...result.rows]);
        }))),
        findAndCount: (_input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, ctx.refuse(commerceError("unsupportedProfile")))),
        update: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const selected = plans.get(entity);
          if (!selected || !Array.isArray(input) || input.length > (entity === rule ? ruleLimit : 8)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
          const pairs: JsonObject[] = [];
          for (const pair of input) {
            if (!shipping) { pairs.push(yield* captureExactNumericUpdatePair(pair, selected.numeric)); continue; }
            const captured = yield* Effect.fromResult(captureCommerceInput(pair, ctx.resources));
            const decoded = yield* Effect.fromResult(decodePair(captured));
            const update = { ...decoded.update };
            for (const column of selected.numeric) if (update[column.name] !== undefined) {
              const raw = update["raw_" + column.name];
              if (raw !== undefined) yield* projectExactNumericColumns(update, [column], "reserialize");
              if (update[column.name] === null && column.nullable) { update["raw_" + column.name] = null; continue; }
              const encoded = yield* encodeExactNumeric(raw !== undefined && isJsonObject(raw) ? raw.value : update[column.name]);
              update[column.name] = encoded.value;
              update["raw_" + column.name] = raw ?? (yield* Effect.fromResult(captureCommerceInput(encoded.raw, ctx.resources)));
            }
            pairs.push({ entity: decoded.entity, update });
          }
          const rows = yield* (yield* ctx.table(entity.table.name)).write(ctx.manager, "update", yield* Effect.fromResult(selected.plan(pairs)));
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", entity.model, rows.map(row => ({ ...row })), shared);
          return structuredClone(rows.map(row => ({ ...row, ...(entity === price && row.price_list_id === null ? { price_list: null } : {}) })));
        }))),
        delete: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* Effect.fromResult((entity === rule ? selectedDelete : decodeDelete)(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
          if (entity === price) {
            return yield* deletePricingPriceRows(ctx, price, rule, selected, ruleLimit);
          }
          const deleted = yield* (yield* ctx.table(entity.table.name)).delete(ctx.manager, selected.$or);
          const ids: string[] = [];
          for (const row of deleted) ids.push(yield* Effect.fromResult(decodeId(row.id)));
          return ids;
        }))),
      });
      return { priceRepository: repository(price), ruleRepository: repository(rule) };
    };
    return { bind, query: queryPlan };
  });
}
