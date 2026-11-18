import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { BigNumber, MathBN } from "@medusajs/framework/utils/portable";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, projectRows, type ProjectionPolicy } from "../../query/projection";
import { bindCommerceRelationRows, populateCommerceRelations, type CommerceRelation, type CommerceRelationRows } from "../../query/relations";
import { resolveCommerceRelationFilter } from "../../query/relation-filter";
import type { Predicate } from "../../query/predicate";
import { projectExactNumericColumns, ExactNumericRaw } from "../../value/exact-numeric";
import { commerceDecoder } from "../../value/decoder";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { preparePromotionPrefilterPort } from "./prefilter-port";
import { capturePromotionComputeQuery, preparePromotionComputeQuery, promotionComputePaths } from "./compute-query";
import type { capturePromotionMetadata } from "./schema";

type Metadata = Effect.Success<ReturnType<typeof capturePromotionMetadata>>["frame"];
const rawNumber = commerceDecoder(ExactNumericRaw, "storedCorruption");

/** Read-only native calculation closure. Historical prefilter cohorts retain
 * their separate port; this DAL hydrates only active final entities. */
export function preparePromotionComputeRead(metadata: Metadata) {
  return Result.gen(function* () {
    const prefilter = yield* preparePromotionPrefilterPort(metadata), byName = new Map(prefilter.entities.map(entity => [entity.table.name, entity]));
    const promotion = byName.get("promotion"), usage = byName.get("promotion_campaign_budget_usage");
    if (promotion === undefined || usage === undefined || metadata.tables.length !== 10)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map<string, Map<string, CommerceRelation>>();
    for (const entity of prefilter.entities) {
      const members = new Map<string, CommerceRelation>();
      for (const declared of entity.table.relationships) {
        if (declared.type === "hasMany" || declared.type === "manyToMany") {
          const descriptor = describeToManyRelation(entity.table, declared.name, metadata.tables);
          if (descriptor === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
          members.set(declared.name, descriptor);
        } else {
          const target = byName.get(declared.targetTable);
          const owned = declared.type === "belongsTo" || declared.type === "hasOneWithFK";
          const keys = (owned ? entity.table : target?.table)?.foreignKeys.filter(key => key.referencedTable === (owned ? target?.table.name : entity.table.name));
          const key = keys?.[0];
          if (target === undefined || keys?.length !== 1 || key?.columns.length !== 1 || key.referencedColumns.length !== 1)
            return yield* Result.fail(commerceError("unsupportedProfile"));
          const base = { name: declared.name, sourcePrimaryKeys: entity.primary, targetPrimaryKeys: target.primary, targetTable: target.table.name };
          if (owned) members.set(declared.name, { ...base, join: { type: "belongsTo", foreignKeys: key.columns } });
          else members.set(declared.name, { ...base, join: { type: "hasOne", foreignKeys: key.columns } });
        }
      }
      relations.set(entity.table.name, members);
    }
    const catalog = yield* makeReadCatalog(prefilter.entities.map(({ table, primary }) => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: primary, foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      nullableColumns: table.columns.filter(column => column.nullable).map(column => column.name),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])) })), relations);
    const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "retain", incomingKeys: true,
      nullToOne: true, selectableRelations: [], nested: new Map() };
    const ruleProjection: ProjectionPolicy = { ...leaf, selectableRelations: ["values"], nested: new Map([["values", leaf]]) };
    const methodProjection: ProjectionPolicy = { ...leaf, selectableRelations: ["target_rules", "buy_rules"], nested: new Map([["target_rules", ruleProjection], ["buy_rules", ruleProjection]]) };
    const campaignProjection: ProjectionPolicy = { ...leaf, selectableRelations: ["budget"], nested: new Map([["budget", leaf]]) };
    const promotionProjection: ProjectionPolicy = { ...leaf, allowedPaths: promotionComputePaths, selectableRelations: ["application_method", "rules", "campaign"],
      nested: new Map([["application_method", methodProjection], ["rules", ruleProjection], ["campaign", campaignProjection]]) };
    const graphProjection: ProjectionPolicy = { ...promotionProjection, keys: "selected", joinKeys: "storage", storageKeys: "last" };
    const rootScalar = yield* prepareScalarRepository(promotion.table, "Promotion", scalarIdWhere);
    const usageScalar = yield* prepareScalarRepository(usage.table, "CampaignBudgetUsage", scalarIdWhere);
    const admitSelection = (table: string, rows: readonly JsonObject[]) => prefilter.complete(table, rows).pipe(Result.map(() => undefined));
    const visible = (predicate: Predicate): Predicate => ({ kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, predicate] });

    const read = Effect.fn("Promotion.computeRead")(function* (readRows: CommerceRelationRows,
      table: "promotion" | "promotion_campaign_budget_usage", input: unknown) {
      const parsed = yield* Effect.fromResult(preparePromotionComputeQuery(table, input));
      let predicate: Predicate;
      if (parsed.active) {
        const campaign = yield* resolveCommerceRelationFilter(readRows, promotion.table.name, "campaign", parsed.campaignPredicate, catalog.relations);
        predicate = { kind: "and", children: [{ kind: "in", column: "status", values: ["active"] }, { kind: "or", children: [
          { kind: "and", children: [{ kind: "isNull", column: "campaign_id" }, parsed.candidateA] },
          { kind: "and", children: [parsed.candidateB, campaign] },
        ] }] };
      } else predicate = parsed.predicate;
      const rows = yield* readRows(table, visible(predicate), "id", { includeIdentities: true });
      const window = parsed.graph ? rows.slice(0, parsed.value.options.limit ?? rows.length) : rows;
      const populated = yield* populateCommerceRelations(readRows, table, window, parsed.value.options.populate, catalog.relations, new Map());
      const projection = yield* Effect.fromResult(compileProjection(catalog, table, parsed.value.options.fields, parsed.value.options.populate,
        table === promotion.table.name ? parsed.graph ? graphProjection : promotionProjection : leaf));
      const selected = yield* Effect.fromResult(projectRows(populated, projection.node));
      if (parsed.active) yield* orderByApplicationValue(selected);
      return { rows: selected, count: rows.length, parsed };
    });

    /** Use native numeric entities for internal calculations and comparisons;
     * public serialization remains the separate native DTO boundary. */
    const internal = Effect.fn("Promotion.internalEntity")(function* (input: Json, table: string): Effect.fn.Return<unknown, CommerceTransactionError> {
      const entity = byName.get(table);
      if (entity === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
      const output: Record<string, unknown>[] = [];
      for (const value of Array.isArray(input) ? input : [input]) {
        if (!isJsonObject(value)) return yield* Effect.fail(commerceError("storedCorruption"));
        const scalar: Record<string, Json> = { ...value }, nested: Record<string, unknown> = {};
        for (const relation of relations.get(table)?.values() ?? []) if (Object.hasOwn(scalar, relation.name)) {
          const child = scalar[relation.name]; delete scalar[relation.name];
          if (child === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
          nested[relation.name] = child === null ? null : yield* internal(child, relation.targetTable);
        }
        const numbers = entity.table.columns.filter(column => column.type === "bigNumber");
        const exact = yield* projectExactNumericColumns(scalar, numbers, "exact");
        if (!isJsonObject(exact)) return yield* Effect.fail(commerceError("storedCorruption"));
        const row: Record<string, unknown> = { ...exact, ...nested };
        for (const column of numbers) if (Object.hasOwn(exact, column.name) && exact[column.name] !== null) {
          const raw = yield* Effect.fromResult(rawNumber(exact["raw_" + column.name]));
          row[column.name] = yield* Effect.try({ try: () => new BigNumber(raw), catch: cause => commerceError("storedCorruption", cause) });
        }
        output.push(row);
      }
      return Array.isArray(input) ? output : output[0];
    });

    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const root = rootScalar.bind(ctx, owner), { bridge } = root, usages = usageScalar.bind(ctx, owner, root.events, bridge);
      const denied = deniedCommerceRepository(root.repository, root.refuse), issued = new WeakSet<object>();
      const find = (table: "promotion" | "promotion_campaign_budget_usage", input: unknown, shared: Parameters<DAL.RepositoryService["find"]>[1]) =>
        bridge.executeInput(shared, input, (current, captured) => bridge.checked(current, Effect.gen(function* () {
          const result = yield* read(bindCommerceRelationRows({ ...current, admitSelection }, { includeIdentities: true }), table, captured);
          const native = yield* internal(result.rows, table);
          if (!Array.isArray(native)) return yield* current.refuse(commerceError("storedCorruption"));
          issued.add(native);
          return { rows: native, count: result.count, graph: result.parsed.graph };
        })), (_current, value) => capturePromotionComputeQuery(value));
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
        owner.run(bridge.checked(bridge.current(), Effect.gen(function* () {
          if (options !== undefined || input === null || typeof input !== "object" || !issued.has(input))
            return yield* ctx.refuse(commerceError("storedCorruption"));
          // SAFETY: the native DTO generic is supplied by its actual module;
          // only issued, complete and metadata-validated selections enter here.
          return (yield* Effect.fromResult(captureNativeNumericDto(input))) as Output;
        })));
      const repository: DAL.RepositoryService = { ...denied, serialize, find: async (input, shared) => (await find("promotion", input, shared)).rows,
        findAndCount: async (input, shared) => { const result = await find("promotion", input, shared);
          if (!result.graph) return root.refuse();
          return [result.rows, result.count]; } };
      const usageRepository: DAL.RepositoryService = { ...deniedCommerceRepository(usages.repository, usages.refuse),
        find: async (input, shared) => (await find("promotion_campaign_budget_usage", input, shared)).rows };
      return { ...root, repository, usageRepository, denied, prefilter: prefilter.bind(bridge) };
    };
    return { bind, read, internal, prefilter, catalog, relations, entities: prefilter.entities, query: preparePromotionComputeQuery,
      captureQuery: capturePromotionComputeQuery, admitSelection, table: yield* catalog.table(promotion.table.name) };
  });
}

/** Exact bounded persistence ordering. PostgreSQL DESC puts NULL first. Native
 * SQL does not specify equal-value order, so this profile refuses such cohorts. */
const orderByApplicationValue = Effect.fn("Promotion.orderApplicationValue")(function* (rows: JsonObject[]) {
  const values = new Map<JsonObject, string | null>(), seen = new Set<string>();
  for (const row of rows) {
    const method = row.application_method;
    if (method === undefined || method !== null && !isJsonObject(method)) return yield* Effect.fail(commerceError("storedCorruption"));
    const value = method === null || method.value === null ? null : (yield* Effect.fromResult(rawNumber(method.raw_value))).value;
    const key = value === null ? "null" : MathBN.convert(value).toFixed();
    if (seen.has(key)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    seen.add(key); values.set(row, value);
  }
  rows.sort((left, right) => {
    const a = values.get(left), b = values.get(right);
    if (a === null) return b === null ? 0 : -1;
    if (b === null) return 1;
    if (a === undefined || b === undefined) throw new Error("Promotion ordering lost a checked row");
    const compared = MathBN.convert(b).comparedTo(MathBN.convert(a));
    if (compared === null) throw new Error("Promotion ordering lost a checked finite quantity");
    return compared;
  });
});
