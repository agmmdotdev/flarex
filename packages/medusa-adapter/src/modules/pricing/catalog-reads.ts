import { Effect, Result, Schema } from "effect";
import { Price, PriceList, PriceListRule, PriceSet, PriceRule, PricePreference } from "@medusajs/pricing/models";
import { PricingModuleService } from "@medusajs/pricing/services";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceRepositoryContext } from "../../repository/context";
import { projectNativeRow } from "../../repository/result";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { decodeGraphCount } from "../../local-graph/query";
import { makeReadCatalog } from "../../query/catalog";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { executeRead, type ReadPlan } from "../../query/read";
import type { CommerceRelation } from "../../query/relations";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { capturePricingMetadata } from "./schema";

const Text = Schema.String.check(Schema.isMaxLength(256));
const Ids = Schema.Array(Text).check(Schema.isMaxLength(8));
const IdSelection = Schema.Union([Text, Ids]);
const ListFilters = Schema.Struct({ id: IdSelection });
const PriceFilters = Schema.Struct({ price_set_id: Ids, price_list_id: Text });
const SelectedFields = Schema.Array(Text).check(Schema.isLengthBetween(1, 256));
const Config = Schema.Struct({ select: Schema.optionalKey(SelectedFields),
  relations: Schema.optionalKey(Schema.Array(Schema.Literals(["price_list_rules", "prices", "prices.price_rules"])).check(Schema.isMaxLength(3))),
  skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
  withDeleted: Schema.optionalKey(Schema.Literal(false)),
});
const PriceConfig = Schema.Struct({ ...Config.fields, relations: Schema.optionalKey(Schema.Array(Schema.Never)) });
const decodeListInput = commerceDecoder(Schema.Struct({ filters: ListFilters, config: Config }), "unsupportedProfile");
const decodePriceInput = commerceDecoder(Schema.Struct({ filters: PriceFilters, config: PriceConfig }), "unsupportedProfile");
const Options = Schema.Struct({ fields: Schema.optionalKey(SelectedFields),
  populate: Schema.Array(Schema.Literals(["price_list_rules", "prices", "prices.price_rules"])).check(Schema.isMaxLength(3)),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.Struct({ id: Schema.Literal("ASC") }),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })),
});
const decodeListNative = commerceDecoder(Schema.Struct({ where: ListFilters, options: Options }), "unsupportedProfile");
const decodePriceNative = commerceDecoder(Schema.Struct({ where: PriceFilters,
  options: Schema.Struct({ ...Options.fields, populate: Schema.Array(Schema.Never) }) }), "unsupportedProfile");
const scalarProjection: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage",
  selectableRelations: [], nested: new Map() };
const listPaths = ["price_list_rules", "prices", "prices.price_rules"];
const priceProjection: ProjectionPolicy = { ...scalarProjection, allowedPaths: ["price_rules"],
  selectableRelations: ["price_rules"], nested: new Map([["price_rules", scalarProjection]]) };
const listProjection: ProjectionPolicy = { ...scalarProjection, allowedPaths: listPaths,
  selectableRelations: ["price_list_rules", "prices"], nested: new Map([["price_list_rules", scalarProjection], ["prices", priceProjection]]) };

/** HTTP association selection/refetch is a separate read capability. It does
 * not enlarge the normalized input or read authority of any mutation profile. */
export function preparePricingCatalogReadContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const tables = metadata.tables.filter(table => ["price_list", "price_list_rule", "price", "price_set", "price_rule"].includes(table.name));
    const list = tables.find(table => table.name === "price_list"), rule = tables.find(table => table.name === "price_list_rule"),
      price = tables.find(table => table.name === "price"), set = tables.find(table => table.name === "price_set"),
      priceRule = tables.find(table => table.name === "price_rule");
    if (list === undefined || rule === undefined || price === undefined || set === undefined || priceRule === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const rules = describeToManyRelation(list, "price_list_rules", metadata.tables);
    const prices = describeToManyRelation(list, "prices", metadata.tables), priceRules = describeToManyRelation(price, "price_rules", metadata.tables);
    const setKey = price.foreignKeys.find(key => key.referencedTable === set.name);
    if (rules?.join.type !== "hasMany" || rules.join.foreignKeys.length !== 1 || rules.join.foreignKeys[0] !== "price_list_id" ||
      setKey?.columns.length !== 1 || setKey.columns[0] !== "price_set_id" || setKey.referencedColumns.length !== 1 || setKey.referencedColumns[0] !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    if (prices?.join.type !== "hasMany" || prices.join.foreignKeys.length !== 1 || prices.join.foreignKeys[0] !== "price_list_id" ||
      priceRules?.join.type !== "hasMany" || priceRules.join.foreignKeys.length !== 1 || priceRules.join.foreignKeys[0] !== "price_id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const setRelation: CommerceRelation = { name: "price_set", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: set.name,
      join: { type: "belongsTo", foreignKeys: ["price_set_id"] } };
    const relations = new Map<string, Map<string, CommerceRelation>>([
      [list.name, new Map([["price_list_rules", rules], ["prices", prices]])],
      [price.name, new Map<string, CommerceRelation>([["price_set", setRelation], ["price_rules", priceRules]])],
    ]);
    const catalog = yield* makeReadCatalog(tables.map(table => ({ name: table.name, columns: table.columns.map(column => column.name),
      primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])),
    })), relations);
    const complete = new Map<string, (input: unknown) => Result.Result<JsonObject, ReturnType<typeof commerceError>>>();
    for (const table of tables) {
      complete.set(table.name, yield* compileCompleteRow(table));
    }
    const listWhere: WherePolicy = { decode: commerceDecoder(ListFilters, "unsupportedProfile"),
      fields: new Map([["id", { column: "id", decode: commerceDecoder(IdSelection, "unsupportedProfile") }]]) };
    const priceWhere: WherePolicy = { decode: commerceDecoder(PriceFilters, "unsupportedProfile"), fields: new Map([
      ["price_set_id", { column: "price_set_id", decode: commerceDecoder(Ids, "unsupportedProfile") }],
      ["price_list_id", { column: "price_list_id", decode: commerceDecoder(Text, "unsupportedProfile") }],
    ]) };
    const compile = (model: "PriceList" | "Price", input: unknown) => Result.gen(function* () {
      const isList = model === "PriceList";
      const { where, options } = yield* isList ? decodeListNative(input) : decodePriceNative(input);
      const table = isList ? list : price;
      const projection = yield* compileProjection(catalog, table.name, options.fields, options.populate,
        isList ? listProjection : scalarProjection);
      const predicate = yield* compileWhere(where, isList ? listWhere : priceWhere);
      const relationFilters = "price_set_id" in where ? [{ path: "price_set", predicate: { kind: "and", children: [
        { kind: "in", column: "id", values: [...where.price_set_id] }, { kind: "isNull", column: "deleted_at" },
      ] } }] : [];
      return { table: table.name, projection, paths: options.populate, withDeleted: false, ordering: new Map(),
        relationFilters,
        query: { fields: table.columns.map(column => column.name), take: options.limit ?? commerceLimits.catalogRows, skip: options.offset ?? 0,
          order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "database", countAt: "afterPopulation" },
      } satisfies ReadPlan;
    });
    return { catalog, complete, compile, list, price, rule,
      listPaths: yield* relationPaths(catalog, list.name, listPaths, { nativeFields: true }) };
  });
}

/** Native Pricing DAL methods remain the producer of service results. Core
 * supplies protected reads; complete DML rows are authenticated before masking. */
export const makePricingCatalogReads = Effect.fn("PricingAdapter.catalogReads")(function* () {
  const contracts = yield* Effect.fromResult(preparePricingCatalogReadContracts((yield* capturePricingMetadata()).frame));
  const numeric = contracts.price.columns.filter(column => column.type === "bigNumber");
  const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
    const bridge = commerceRepositoryContext(root, owner);
    const refuse = () => owner.run(root.refuse(commerceError("unsupportedProfile")));
    const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
      owner.run(bridge.checked(root, Effect.gen(function* () {
        if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
        const captured = yield* Effect.fromResult(captureCommerceInput(input, root.resources));
        const rows: JsonObject[] = [];
        for (const value of Array.isArray(captured) ? captured : [captured]) {
          if (!isJsonObject(value)) return yield* root.refuse(commerceError("storedCorruption"));
          const prices = value.prices === undefined ? undefined : yield* projectExactNumericColumns(value.prices,
            numeric, "reserialize");
          rows.push(prices === undefined ? value : { ...value, prices });
        }
        const projected = yield* projectExactNumericColumns(rows, numeric, "reserialize");
        if (!Array.isArray(projected) || (!Array.isArray(captured) && projected[0] === undefined))
          return yield* root.refuse(commerceError("storedCorruption"));
        // SAFETY: native DAL generic permits scalar/array partial projections;
        // the selected model's checked DML owns every input to serialization.
        return (Array.isArray(captured) ? projected : projected[0]) as Output;
      })));
    const denied: DAL.RepositoryService = { getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager,
      transaction: bridge.transaction, serialize, find: refuse, findAndCount: refuse, create: refuse, update: refuse,
      upsert: refuse, upsertWithReplace: refuse, delete: refuse, softDelete: refuse, restore: refuse };
    const repository = (model: typeof Price | typeof PriceList | typeof PriceListRule | typeof PriceSet | typeof PriceRule | typeof PricePreference): DAL.RepositoryService => {
      if (model !== PriceList && model !== Price) return denied;
      const name = model === PriceList ? "PriceList" : "Price";
      const find = Effect.fn("PricingCatalogRepository.find")(function* (ctx: CommerceCommandContext, input: unknown, count: boolean) {
        const plan = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(value => contracts.compile(name, value))));
        const prices: JsonObject[] = [];
        const result = yield* executeRead({ ...ctx, admitSelection: (table, rows) => Result.gen(function* () {
          const decode = contracts.complete.get(table);
          if (decode === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
          for (const value of rows) {
            const row = yield* decode(projectNativeRow(value));
            if (row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
            if (table === contracts.price.name) prices.push(row);
          }
        }) }, contracts.catalog, plan, count);
        if (result.rows.length > 8 || prices.length > 8 || result.count !== undefined && result.count > 8)
          return yield* ctx.refuse(commerceError("unsupportedProfile"));
        yield* projectExactNumericColumns(prices, numeric);
        return { ...result, rows: structuredClone(result.rows) };
      });
      return { ...denied, find: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, find(ctx, input, false)).pipe(Effect.map(value => value.rows))),
        findAndCount: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* find(ctx, input, true);
          if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [result.rows, result.count];
        }))) };
    };
    return { baseRepository: denied, repository, refuse };
  };
  const module = yield* Effect.fromResult(defineCommerceModule({ name: "flarex-pricing-local", models: [PriceList, Price, PriceListRule, PriceSet, PriceRule, PricePreference],
    profile: { name: "pricing-catalog-reads", capabilities: [], bind },
    extensions: { pricingRepository: { mode: "add", create: ({ binding }) => ({ calculatePrices: binding.refuse }) } },
    service: ({ dependencies, context }) => {
      const service = new PricingModuleService(dependencies, { scope: "internal" });
      return { listAndCountPriceLists: service.listAndCountPriceLists.bind(service), listAndCountPrices: service.listAndCountPrices.bind(service), context };
    },
  }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause))));
  const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("PricingCatalog.prepare");
  const lists = commands.read("pricingCatalogPriceLists", prepare(decodeListInput), ({ listAndCountPriceLists, context }, args): Promise<unknown> =>
    Reflect.apply(listAndCountPriceLists, undefined, [structuredClone(args.filters), structuredClone(args.config), context]));
  const prices = commands.read("pricingCatalogPrices", prepare(decodePriceInput), ({ listAndCountPrices, context }, args): Promise<unknown> =>
    Reflect.apply(listAndCountPrices, undefined, [structuredClone(args.filters), structuredClone(args.config), context]));
  const joiner = pricingStaticResources.joinerConfig;
  if (joiner === undefined) return yield* commerceError("unsupportedProfile");
  const graph: GraphModuleDefinition = { aliases: (yield* Effect.fromResult(moduleAliases(joiner))).filter(alias => ["PriceList", "Price"].includes(alias.model)),
    reads: [
      { model: "PriceList", command: lists, table: yield* Effect.fromResult(contracts.catalog.table(contracts.list.name)), paths: contracts.listPaths,
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount },
      { model: "Price", command: prices, table: yield* Effect.fromResult(contracts.catalog.table(contracts.price.name)), paths: [],
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount },
    ] };
  return { commands: [lists, prices], graph, contracts };
});
