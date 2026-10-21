import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, useCapturedPrivateJsonData, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { CommerceModuleEvents } from "../../module/persistence";
import { commerceRepositoryContext } from "../../repository/context";
import { commerceMutationEvents } from "../../repository/mutation-events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { encodeExactNumeric, decodeExactNumeric, projectExactNumericColumns } from "../../value/exact-numeric";
import { captureGraph, insertGraphRows } from "../../write/create";
import type { GraphCatalog, GraphEntity, CreationProfile } from "../../write/graph-model";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { compilePopulationWhere, isSelectedPopulationPath } from "../../query/population";
import { executeRead, orderedCatalog, type ReadPlan } from "../../query/read";
import { QueryEnvelope, QueryLimit, QueryOffset } from "../../query/decoder";
import { PricingId } from "./input";
import type { capturePricingMetadata } from "./schema";
import { relationPaths } from "../../local-graph/module";
import { calculateLogicalPrices } from "./calculation";
import { readCommerceRelationRows, assembleCommerceRelations } from "../../query/relations";
import { preparePricingMutations, deletePricingPriceRows } from "./mutation-repository";
import { softDeletePricingPriceSets } from "./lifecycle";
import { preparePricingPreferenceRepository } from "./preference-repository";
import { ShippingNormalizedSet, ShippingNormalizedPrice, ShippingNormalizedRule } from "./shipping-input";
import { changeShippingPriceSets } from "./shipping-lifecycle";
import { NormalizedPriceList, NormalizedListPrice, NormalizedPriceListRule, NormalizedListPriceRule,
  compilePriceListCreationContracts } from "./list-input";
import { deletePricingPriceLists } from "./list-lifecycle";
import { projectNativeRow } from "../../repository/result";
import { compilePriceListUpdateContracts } from "./list-update-input";
import { readPriceListUpdateRows, preparePriceListUpdateReplacement } from "./list-update-repository";
import { compilePriceListDeletionContracts } from "./list-deletion-input";
import { priceListLifecycleMethods } from "./list-deletion-repository";
import { compilePriceListPriceCreationContracts, decodePriceListPricePhysicalSelection } from "./price-list-price-input";
import { preparePriceListPriceReplacement, readPriceListPriceCandidates } from "./price-list-price-repository";
import { compilePriceListPriceUpdateContracts } from "./price-list-price-update-input";
import { readPriceListPriceUpdateRows, readPriceListPriceSnapshotRules, preparePriceListPriceReplay } from "./price-list-price-update-repository";
import { compilePriceListPriceRemovalContracts } from "./price-list-price-removal-input";
import { readPriceListPriceRemovalRows } from "./price-list-price-removal-repository";
import { priceListPriceRemovalLifecycleMethods } from "./price-list-price-removal-lifecycle";

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
const decodeShippingSet = commerceDecoder(ShippingNormalizedSet, "unsupportedProfile");
const decodeShippingPrice = commerceDecoder(ShippingNormalizedPrice, "unsupportedProfile");
const decodeShippingRule = commerceDecoder(ShippingNormalizedRule, "unsupportedProfile");
const decodePrice = commerceDecoder(Price, "unsupportedProfile");
const decodeRule = commerceDecoder(Rule, "unsupportedProfile");
const decodeList = commerceDecoder(NormalizedPriceList, "unsupportedProfile");
const decodeListPrice = commerceDecoder(NormalizedListPrice, "unsupportedProfile");
const decodeListRule = commerceDecoder(NormalizedPriceListRule, "unsupportedProfile");
const decodeListPriceRule = commerceDecoder(NormalizedListPriceRule, "unsupportedProfile");
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeStoredRows = commerceDecoder(Schema.Array(Schema.JsonObject), "storedCorruption");
const decodeSerialized = commerceDecoder(Schema.Union([Schema.JsonObject, Schema.Array(Schema.JsonObject)]), "storedCorruption");
const decodeRuleFind = commerceDecoder(Schema.Struct({
  where: Schema.Struct({ price_id: Schema.Array(PricingId).check(Schema.isMaxLength(256)) }),
  options: Schema.Unknown,
}), "unsupportedProfile");
const decodePreferenceFind = commerceDecoder(Schema.Struct({
  where: Schema.Struct({ $or: Schema.Array(Schema.Struct({ attribute: Schema.String, value: Schema.String })).check(Schema.isMaxLength(2)) }),
  options: Schema.Unknown,
}), "unsupportedProfile");
const decodeTaxRules = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: PricingId, price_id: PricingId, attribute: Schema.String, value: Schema.String,
  operator: Schema.String, deleted_at: Schema.NullOr(Schema.String),
}), [Schema.Record(Schema.String, Schema.Json)])), "storedCorruption");
const decodePreferences = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: PricingId, attribute: Schema.String, value: Schema.NullOr(Schema.String),
  is_tax_inclusive: Schema.Boolean, deleted_at: Schema.NullOr(Schema.String),
}), [Schema.Record(Schema.String, Schema.Json)])), "storedCorruption");
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
export type PricingRepositoryAdmission = "create" | "variant-updates" | "product-updates" | "price-preferences" |
  "price-preference-updates" | "price-preference-deletions" | "price-list-creations" | "price-list-updates" | "price-list-deletions" | "price-list-price-creations" | "price-list-price-updates" | "price-list-price-removals" | "shipping-options" | "shipping-option-updates";
export function preparePricingRepository(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"], admission: PricingRepositoryAdmission = "create") {
  return Result.gen(function* () {
    const mutable = admission === "variant-updates" || admission === "product-updates", lifecycle = admission === "product-updates";
    const preferenceUpdates = admission === "price-preference-updates", preferenceDeletions = admission === "price-preference-deletions";
    const preferences = admission === "price-preferences" || preferenceUpdates || preferenceDeletions;
    const shippingUpdates = admission === "shipping-option-updates", shipping = admission === "shipping-options" || shippingUpdates;
    const listCreations = admission === "price-list-creations";
    const listUpdates = admission === "price-list-updates";
    const listDeletions = admission === "price-list-deletions";
    const listPriceCreations = admission === "price-list-price-creations";
    const listPriceUpdates = admission === "price-list-price-updates";
    const listPriceRemovals = admission === "price-list-price-removals";
    const listPriceRemovalContracts = listPriceRemovals ? yield* compilePriceListPriceRemovalContracts(metadata) : undefined;
    const listPriceUpdateContracts = listPriceUpdates ? yield* compilePriceListPriceUpdateContracts(metadata) : undefined;
    const listPriceReplay = listPriceUpdateContracts === undefined ? undefined : yield* preparePriceListPriceReplay(listPriceUpdateContracts);
    const listDeletionContracts = listDeletions ? yield* compilePriceListDeletionContracts(metadata) : undefined;
    if (preferences) {
      const prepared = yield* preparePricingPreferenceRepository(metadata, preferenceDeletions ? "deletions" : preferenceUpdates ? "updates" : "store");
      return { ...prepared, query: undefined, mutationQuery: undefined };
    }
    const listUpdate = listUpdates ? yield* Result.gen(function* () {
      const contracts = yield* compilePriceListUpdateContracts(metadata);
      const replacement = yield* preparePriceListUpdateReplacement(contracts);
      return { contracts, ...replacement };
    }) : undefined;
    const listPrice = listPriceCreations || listPriceUpdates ? yield* Result.gen(function* () {
      const contracts = listPriceUpdateContracts ?? (yield* compilePriceListPriceCreationContracts(metadata));
      const replacement = yield* preparePriceListPriceReplacement(contracts, listPriceUpdates ? "update" : "creation");
      return { contracts, ...replacement };
    }) : undefined;
    const entities: GraphEntity[] = [];
    for (const [name, model] of [["price_set", "PriceSet"], ["price", "Price"], ["price_rule", "PriceRule"],
      ["price_list", "PriceList"], ["price_list_rule", "PriceListRule"]] as const) {
      const table = metadata.tables.find(item => item.name === name);
      const key = table?.columns.find(column => column.primaryKey);
      if (table === undefined || key?.type !== "id" || key.name !== "id") return yield* Result.fail(commerceError("unsupportedProfile"));
      entities.push({ table, model, keyColumn: key.name, prefix: key.options?.prefix });
    }
    const [set, price, rule, list, listRule] = entities;
    if (!set || !price || !rule || !list || !listRule) return yield* Result.fail(commerceError("unsupportedProfile"));
    const preference = yield* preparePricingPreferenceRepository(metadata);
    const listContracts = yield* compilePriceListCreationContracts(metadata);
    const setTable = metadata.tables.find(table => table.name === set.table.name);
    const priceTable = metadata.tables.find(table => table.name === price.table.name);
    if (!setTable || !priceTable) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prices = describeToManyRelation(setTable, "prices", metadata.tables);
    const rules = describeToManyRelation(priceTable, "price_rules", metadata.tables);
    const listTable = metadata.tables.find(table => table.name === list.table.name);
    const listPrices = listTable && describeToManyRelation(listTable, "prices", metadata.tables);
    const listRules = listTable && describeToManyRelation(listTable, "price_list_rules", metadata.tables);
    if (prices?.join.type !== "hasMany" || rules?.join.type !== "hasMany" || prices.join.foreignKeys.length !== 1 || rules.join.foreignKeys.length !== 1) return yield* Result.fail(commerceError("unsupportedProfile"));
    const priceForeignKey = prices.join.foreignKeys[0], ruleForeignKey = rules.join.foreignKeys[0];
    if (!priceForeignKey || !ruleForeignKey) return yield* Result.fail(commerceError("unsupportedProfile"));
    if (listPrices?.join.type !== "hasMany" || listRules?.join.type !== "hasMany" ||
      listPrices.join.foreignKeys.length !== 1 || listRules.join.foreignKeys.length !== 1)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const listPriceForeignKey = listPrices.join.foreignKeys[0], listRuleForeignKey = listRules.join.foreignKeys[0];
    if (!listPriceForeignKey || !listRuleForeignKey) return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map([[set.table.name, new Map([["prices", prices]])], [price.table.name, new Map([["price_rules", rules]])]]);
    const readCatalog = yield* makeReadCatalog([set, price, rule].map(entity => ({ name: entity.table.name,
      columns: entity.table.columns.map(column => column.name), primaryKeys: [entity.keyColumn],
      foreignKeys: entity.table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(entity.table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])),
    })), relations);
    const catalog: GraphCatalog = { entities: [set, price, rule], tables: [set.table, price.table, rule.table],
      writablePivots: [], queryRelations: relations,
      decodeRow: (entity, input) => Result.gen(function* () {
        const supplied = entity === set ? yield* (shipping ? decodeShippingSet : decodeSet)(input)
          : entity === price ? yield* (shipping ? decodeShippingPrice : decodePrice)(input) : yield* (shipping ? decodeShippingRule : decodeRule)(input);
        return { supplied, key: supplied.id };
      }),
      decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
    };
    const creation: CreationProfile = { catalog, root: { entity: set, omitRelations: ["prices"], steps: [
      { kind: "children", name: "prices", foreignKey: priceForeignKey, node: { entity: price, omitRelations: shipping ? ["price_rules", "rules"] : ["price_rules"], steps: [
        { kind: "children", name: "price_rules", foreignKey: ruleForeignKey, node: { entity: rule, omitRelations: [], steps: [] } },
      ] } },
    ] }, rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) };
    const mutations = mutable || shippingUpdates ? yield* preparePricingMutations(catalog, price, rule,
      priceTable.relationships.some(relation => relation.name === "price_rules" && relation.cascadeDelete), shippingUpdates) : undefined;
    const numeric = price.table.columns.filter(column => column.type === "bigNumber");
    const serializeGraph = Effect.fn("PricingRepository.serializeGraph")(function* (value: Json) {
      const output: JsonObject[] = [];
      for (const input of Array.isArray(value) ? value : [value]) {
        if (!isJsonObject(input)) return yield* Effect.fail(commerceError("storedCorruption"));
        const projected = yield* projectExactNumericColumns(input, numeric, "reserialize");
        if (!isJsonObject(projected)) return yield* Effect.fail(commerceError("storedCorruption"));
        let row = projected;
        if (input.prices !== undefined) {
          yield* Effect.fromResult(decodeStoredRows(input.prices));
          const prices = yield* projectExactNumericColumns(input.prices, numeric, "reserialize");
          if (prices !== row.prices) row = { ...row, prices };
        }
        output.push(row);
      }
      return Array.isArray(value) ? output.every((row, index) => row === value[index]) ? value : output : output[0]!;
    });
    const listRelations = new Map(relations);
    listRelations.set(list.table.name, new Map([["prices", listPrices], ["price_list_rules", listRules]]));
    // The original ORM emits afterCreate in this dependency order, retaining
    // input order within each model. The shared graph bridge preserves it.
    const listCatalog: GraphCatalog = { entities: [list, listRule, price, rule],
      tables: [list.table, listRule.table, price.table, rule.table], writablePivots: [], queryRelations: listRelations,
      decodeRow: (entity, input) => Result.gen(function* () {
        const supplied = entity === list ? yield* decodeList(input) : entity === price ? yield* decodeListPrice(input)
          : entity === rule ? yield* decodeListPriceRule(input) : yield* decodeListRule(input);
        return { supplied, key: supplied.id };
      }),
      decodeReference: () => Result.fail(commerceError("unsupportedProfile")),
      decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
    };
    const listCreation: CreationProfile = { catalog: listCatalog, root: { entity: list,
      omitRelations: ["prices", "price_list_rules"], steps: [
        { kind: "children", name: "prices", foreignKey: listPriceForeignKey,
          node: { entity: price, omitRelations: ["price_rules"], steps: [
            { kind: "children", name: "price_rules", foreignKey: ruleForeignKey,
              node: { entity: rule, omitRelations: [], steps: [] } },
          ] } },
        { kind: "children", name: "price_list_rules", foreignKey: listRuleForeignKey,
          node: { entity: listRule, omitRelations: [], steps: [] } },
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
      const preferenceCreate = preference.bind(root, owner, events, bridge).preferenceRepository.create;
      const refuse = () => owner.run(root.refuse(commerceError("unsupportedProfile")));
      const mutationEvents: CommerceModuleEvents = { createEventSubscriber: events.createSubscriber, registerEventSubscriber: events.registerSubscriber,
        dispatchMutationEvent: (event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          if ((!events.isSubscribed(shared) && (subscriber === undefined || !events.ownsSubscriber(subscriber))) ||
            !(listUpdates || listPriceCreations || listPriceUpdates ? ["afterCreate", "afterUpdate", "afterDelete"] : mutable || shipping || listDeletions || listPriceRemovals ? ["afterDelete", "afterUpdate"] : ["afterDelete"]).includes(event)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.dispatch(event, args, shared, subscriber);
        }))),
      };
      const find = Effect.fn("PricingRepository.find")(function* (ctx: CommerceCommandContext, input: unknown, count: boolean) {
        const plan = yield* Effect.fromResult(query(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        const result = yield* executeRead(ctx, readCatalog, plan, count);
        // Validate exact entities here; public DTO conversion belongs to serialize.
        const output: JsonObject[] = [];
        for (const row of result.rows) {
          const children = row.prices;
          if (children === undefined) { output.push(row); continue; }
          yield* Effect.fromResult(decodeStoredRows(children));
          if (!Array.isArray(children)) return yield* Effect.fail(commerceError("storedCorruption"));
          const prices: JsonObject[] = [];
          for (const stored of children) {
            if (!isJsonObject(stored)) return yield* Effect.fail(commerceError("storedCorruption"));
            const child = { ...stored };
            if (child.price_list_id === null) child.price_list = null;
            for (const column of price.table.columns) if (column.type === "bigNumber" && Object.hasOwn(child, column.name)) {
              yield* decodeExactNumeric(child[column.name], child["raw_" + column.name], column.nullable);
            }
            const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(child, Number.MAX_SAFE_INTEGER, commerceError));
            if (!isJsonObject(captured.value)) return yield* Effect.fail(commerceError("storedCorruption"));
            prices.push(captured.value);
          }
          const captured = yield* Effect.fromResult(useCapturedPrivateJsonData({ ...row, prices }, Number.MAX_SAFE_INTEGER, commerceError));
          if (!isJsonObject(captured.value)) return yield* Effect.fail(commerceError("storedCorruption"));
          output.push(captured.value);
        }
        // Native updates replace child arrays on returned entities. Core read
        // evidence stays immutable; hand detached mutable graphs to the DAL.
        return { ...result, rows: structuredClone(output) };
      });
      const createGraph = Effect.fn("PricingRepository.createGraph")(function* (
        ctx: CommerceCommandContext, profile: CreationProfile,
        input: unknown, shared: Parameters<DAL.RepositoryService["create"]>[1],
      ) {
        const graph = yield* captureGraph(profile, input, ctx.resources);
        const rows = new Map(graph.rows);
        if (shipping && (rows.get(rule.table.name)?.length ?? 0) > 24) return yield* ctx.refuse(commerceError("limitExceeded"));
        const values: JsonObject[] = [];
        for (const inputRow of rows.get(price.table.name) ?? []) {
          const row = { ...inputRow };
          if (shippingUpdates) yield* projectExactNumericColumns(row, numeric.filter(column => row["raw_" + column.name] !== undefined), "reserialize");
          for (const column of price.table.columns) if (column.type === "bigNumber") {
            const value = row[column.name];
            if ((value === undefined || value === null) && column.nullable) { row[column.name] = null; row["raw_" + column.name] = null; }
            else { const suppliedRaw = shippingUpdates ? row["raw_" + column.name] : undefined;
              const encoded = yield* encodeExactNumeric(suppliedRaw !== undefined && isJsonObject(suppliedRaw) ? suppliedRaw.value : value); row[column.name] = encoded.value;
              row["raw_" + column.name] = suppliedRaw ?? (yield* Effect.fromResult(captureCommerceInput(encoded.raw, ctx.resources))); }
          }
          values.push(row);
        }
        rows.set(price.table.name, values);
        const inserted = yield* insertGraphRows(ctx, profile.catalog, rows, shippingUpdates ? { allowReconstitution: true } : {});
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* events.created(profile.catalog.entities.flatMap(entity => (inserted.get(entity.table.name) ?? [])
          .map(row => ({ modelName: entity.model, entity: { ...row } }))), shared);
        if (profile.root.entity === price) return assembleCommerceRelations(price.table.name, inserted, ["price_rules"],
          catalog.queryRelations).map(row => ({ ...row, ...(row.price_list_id === null ? { price_list: null } : {}) }));
        if (profile.root.entity === list) return assembleCommerceRelations(list.table.name,
          new Map([...inserted].map(([table, rows]) => [table, rows.map(projectNativeRow)])),
          ["prices", "prices.price_rules", "price_list_rules"], listCatalog.queryRelations);
        return [...inserted.get(profile.root.entity.table.name) ?? []];
      });
      const repository: DAL.RepositoryService = {
        getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
        serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> => owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
          const value = yield* Effect.fromResult(captureCommerceInput(input, root.resources));
          yield* Effect.fromResult(decodeSerialized(value));
          // SAFETY: the native DAL generic also covers partial projections;
          // graph rows and selected scalar values were validated above.
          // Native entities keep exact decimal pairs until this public DTO edge.
          const serialized = yield* serializeGraph(value);
          const roots = Array.isArray(serialized) ? serialized : [serialized];
          if (listUpdate !== undefined) yield* Effect.fromResult(listUpdate.contracts.decodeReadOutput(roots));
          else if (roots.some(row => isJsonObject(row) && Object.hasOwn(row, "price_list_rules")))
            yield* Effect.fromResult(listContracts.decodeOutput(roots));
          return serialized as Output;
        }))),
        find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, find(ctx, input, false)).pipe(Effect.map(value => value.rows))),
        findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const value = yield* find(ctx, input, true);
          if (value.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [value.rows, value.count] satisfies [JsonObject[], number];
        }))),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, createGraph(ctx, creation, input, shared))),
        update: refuse, upsert: refuse, upsertWithReplace: refuse,
        delete: shipping ? (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* changeShippingPriceSets(ctx, metadata, input, "delete");
          const ids: string[] = [];
          for (const row of result.roots) {
            if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
            ids.push(row.id);
          }
          return ids;
        }))) : refuse,
        restore: shipping ? (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* changeShippingPriceSets(ctx, metadata, input, "restore");
          if (shared === undefined) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.cascades(result.cascades, shared, row => ({ entity: row, originalEntity: { deleted_at: row.updated_at } }));
          return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
        }))) : refuse,
        softDelete: lifecycle || shipping ? (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const result = shipping ? yield* changeShippingPriceSets(ctx, metadata, input, "softDelete") : yield* softDeletePricingPriceSets(ctx, metadata, input);
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.cascades(result.cascades, shared, row => ({ entity: row, originalEntity: { deleted_at: null } }));
          return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
        }))) : refuse,
      };
      const denied: DAL.RepositoryService = { ...repository, serialize: refuse, find: refuse, findAndCount: refuse, create: refuse, softDelete: refuse, restore: refuse, delete: refuse };
      const listLifecycle = listDeletionContracts === undefined ? undefined : priceListLifecycleMethods(listDeletionContracts, bridge, events);
      const listRepository: DAL.RepositoryService = { ...denied, serialize: repository.serialize,
        ...(listLifecycle === undefined ? {} : listLifecycle),
        create: listUpdates || listDeletions || listPriceCreations || listPriceUpdates || listPriceRemovals ? refuse : (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, createGraph(ctx, listCreation, input, shared))),
        find: listPrice !== undefined ? (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx,
          readPriceListUpdateRows(ctx, listPrice.contracts.listReadContracts, captured))) : listUpdate === undefined ? refuse :
          (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, readPriceListUpdateRows(ctx, listUpdate.contracts, input))),
        upsertWithReplace: listUpdate === undefined ? refuse : (input, config, shared) => bridge.execute(shared, ctx => bridge.checked(ctx,
          listUpdate.replace(ctx, input, config))),
        delete: listCreations ? (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* deletePricingPriceLists(ctx, metadata, input);
          const ids: string[] = [];
          for (const row of result.roots) {
            if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
            ids.push(row.id);
          }
          return ids;
        }))) : refuse,
      };
      const findTaxRules = Effect.fn("PricingRepository.findTaxRules")(function* (ctx: CommerceCommandContext, input: unknown) {
          const query = yield* Effect.fromResult(decodeRuleFind(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
          const ids = [...new Set(query.where.price_id)];
          const rows: JsonObject[] = [];
          for (let offset = 0; offset < ids.length; offset += 16) {
            rows.push(...yield* readCommerceRelationRows(ctx, "price_rule", { kind: "and", children: [
              { kind: "in", column: "price_id", values: ids.slice(offset, offset + 16) },
              { kind: "isNull", column: "deleted_at" },
            ] }));
          }
          return [...yield* Effect.fromResult(decodeTaxRules(rows))];
      });
      const ruleRepository: DAL.RepositoryService = { ...denied, serialize: repository.serialize,
        find: listPriceUpdateContracts === undefined ? (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, findTaxRules(ctx, input)))
          : (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx,
            readPriceListPriceSnapshotRules(ctx, listPriceUpdateContracts, captured))),
      };
      const mutationRepositories = mutations?.bind(bridge, events, { ...denied, serialize: repository.serialize }, createGraph, findTaxRules);
      const listPriceRepository: DAL.RepositoryService | undefined = listPrice === undefined ? undefined : {
        ...denied, serialize: repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx,
          listPriceUpdateContracts === undefined ? readPriceListPriceCandidates(ctx, listPrice.contracts, captured)
            : readPriceListPriceUpdateRows(ctx, listPriceUpdateContracts, captured))),
        upsertWithReplace: (input, config, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          // The private native inverse supplies complete persisted roots. This
          // dispatch grants no authority: core proves exact recorded rows.
          if (listPriceReplay !== undefined && Array.isArray(captured) && captured.some(row => isJsonObject(row) && Object.hasOwn(row, "created_at")))
            return yield* listPriceReplay.replay(ctx, captured, config);
          return yield* listPrice.replace(ctx, captured, config);
        }))),
        delete: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodePriceListPricePhysicalSelection)));
          return yield* deletePricingPriceRows(ctx, listPrice.root, listPrice.rule, selected, ctx.resources.queryRows, "storageInsertion");
        }))),
      };
      const priceRemovalRepository: DAL.RepositoryService | undefined = listPriceRemovalContracts === undefined ? undefined : {
        ...denied, serialize: repository.serialize,
        ...priceListPriceRemovalLifecycleMethods(listPriceRemovalContracts, bridge, events),
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx,
          readPriceListPriceRemovalRows(ctx, listPriceRemovalContracts, captured))),
      };
      const preferenceRepository: DAL.RepositoryService = { ...denied, serialize: repository.serialize,
        create: preferenceCreate,
        find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const query = yield* Effect.fromResult(decodePreferenceFind(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
          const pairs = [...new Map(query.where.$or.map(member =>
            [JSON.stringify([member.attribute, member.value]), [member.attribute, member.value]])).values()];
          if (pairs.length === 0) return [];
          const rows = yield* readCommerceRelationRows(ctx, "price_preference", { kind: "and", children: [
            { kind: "indexedPoints", columns: ["attribute", "value"], values: pairs },
            { kind: "isNull", column: "deleted_at" },
          ] });
          return [...yield* Effect.fromResult(decodePreferences(rows))];
        }))),
      };
      const calculatePrices = (filters: Parameters<import("@medusajs/framework/types").PricingRepositoryService["calculatePrices"]>[0],
        pricingContext: Parameters<import("@medusajs/framework/types").PricingRepositoryService["calculatePrices"]>[1],
        shared: Parameters<import("@medusajs/framework/types").PricingRepositoryService["calculatePrices"]>[2]) =>
        bridge.execute(shared, ctx => bridge.checked(ctx, calculateLogicalPrices(ctx, { filters, pricingContext })));
      return { repository, denied, listRepository, ruleRepository: mutationRepositories?.ruleRepository ?? ruleRepository,
        priceRepository: priceRemovalRepository ?? listPriceRepository ?? mutationRepositories?.priceRepository ?? denied, preferenceRepository, mutationEvents, bridge, refuse, calculatePrices };
    };
    return { bind, query, mutationQuery: mutations?.query, table: yield* readCatalog.table(set.table.name), paths: yield* relationPaths(readCatalog, set.table.name, paths, shippingUpdates ? { nativeFields: true } : undefined) };
  });
}
