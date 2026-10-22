import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { executeRead, orderedCatalog, type ReadPlan } from "../../query/read";
import { readCommerceRelationRows, type CommerceRelation, type CommerceRelationReadContext } from "../../query/relations";
import { resolveCommerceRelationFilter } from "../../query/relation-filter";
import { type Predicate } from "../../query/predicate";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { compileCompleteRow } from "../../value/complete-row";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { prepareTaxRateQuery, prepareTaxRegionQuery, taxLinesLimits, TaxId } from "./query";
import type { captureTaxMetadata } from "./schema";

type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];
const scalarProjection: ProjectionPolicy = { keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
const rateProjection: ProjectionPolicy = { ...scalarProjection, allowedPaths: ["tax_region", "rules"], selectableRelations: ["tax_region", "rules"],
  nested: new Map([["tax_region", scalarProjection], ["rules", scalarProjection]]) };
const active = (predicate: Predicate): { readonly kind: "and"; readonly children: readonly Predicate[] } =>
  ({ kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] });
const decodeId = commerceDecoder(TaxId, "storedCorruption");

/** Only the genuine service's Region and candidate Rate reads are admitted.
 * Complete regional cohorts establish bounds before rule-existence filtering;
 * shared relation owners retain SQL selection and full relation hydration. */
export function prepareTaxLinesRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const region = metadata.tables.find(table => table.name === "tax_region"), rate = metadata.tables.find(table => table.name === "tax_rate"),
      rule = metadata.tables.find(table => table.name === "tax_rate_rule"), provider = metadata.tables.find(table => table.name === "tax_provider");
    if (metadata.tables.length !== 4 || region === undefined || rate === undefined || rule === undefined || provider === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const keyed = (complete: Result.Result.Success<ReturnType<typeof compileCompleteRow>>) =>
      (input: unknown): Result.Result<JsonObject & { readonly id: string }, CommerceTransactionError> => Result.gen(function* () {
      const row = yield* complete(input), id = yield* decodeId(row.id);
      return { ...row, id };
    });
    const decodeRegion = keyed(yield* compileCompleteRow(region)), decodeRate = keyed(yield* compileCompleteRow(rate)), decodeRule = keyed(yield* compileCompleteRow(rule));
    const rules = describeToManyRelation(rate, "rules", metadata.tables), regionRelation = rate.relationships.find(relationship => relationship.name === "tax_region"),
      regionKey = rate.foreignKeys.find(key => key.referencedTable === region.name);
    if (rules?.join.type !== "hasMany" || rules.targetTable !== rule.name || rules.join.foreignKeys.length !== 1 || rules.join.foreignKeys[0] !== "tax_rate_id" ||
      regionRelation?.type !== "belongsTo" || regionRelation.targetTable !== region.name || regionKey?.columns.length !== 1 ||
      regionKey.columns[0] !== "tax_region_id" || regionKey.referencedColumns.length !== 1 || regionKey.referencedColumns[0] !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const taxRegion: CommerceRelation = { name: "tax_region", targetTable: region.name, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
      join: { type: "belongsTo", foreignKeys: [...regionKey.columns] } };
    const relations = new Map([[rate.name, new Map<string, CommerceRelation>([["rules", rules], ["tax_region", taxRegion]])]]);
    const catalog = yield* makeReadCatalog(metadata.tables.map(table => ({ name: table.name, columns: table.columns.map(column => column.name),
      primaryKeys: table.columns.filter(column => column.primaryKey).map(column => column.name),
      foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {} })), relations);
    const regionProjection = yield* compileProjection(catalog, region.name, undefined, [], scalarProjection);
    const candidateProjection = yield* compileProjection(catalog, rate.name, undefined, ["tax_region", "rules"], rateProjection);
    const scalar = yield* prepareScalarRepository(region, "TaxRegion", scalarIdWhere);
    const admission = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
      const decode = table === region.name ? decodeRegion : table === rate.name ? decodeRate : table === rule.name ? decodeRule : undefined;
      const limit = table === region.name ? taxLinesLimits.regions : table === rate.name ? taxLinesLimits.rates : taxLinesLimits.rules;
      if (decode === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (rows.length > limit) return yield* Result.fail(commerceError("limitExceeded"));
      const ids = new Set<string>();
      for (const row of rows) {
        const complete = yield* decode(projectNativeRow(row));
        if (typeof complete.id !== "string" || complete.id.length === 0 || ids.has(complete.id) || complete.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        ids.add(complete.id);
      }
    });
    const regionPlan = (parsed: Result.Result.Success<ReturnType<typeof prepareTaxRegionQuery>>) =>
      ({ table: region.name, projection: regionProjection, paths: [], relationFilters: [],
        ordering: new Map(), withDeleted: false, query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: active(parsed.predicate) },
        window: { kind: "catalog", order: "id", select: orderedCatalog("asc") } } satisfies ReadPlan);
    const regionalRatePredicate = (regionIds: readonly string[]) => active({ kind: "in", column: "tax_region_id", values: [...regionIds] });
    const ruleCohortPredicate = (regionalIds: readonly string[]) => active({ kind: "in", column: "tax_rate_id", values: [...regionalIds] });
    const candidatePlan = (regionIds: readonly string[], matchingRules?: Predicate) => {
      const alternatives: Predicate[] = [{ kind: "in", column: "is_default", values: [true] }];
      if (matchingRules !== undefined) alternatives.push(matchingRules);
      return { table: rate.name, projection: candidateProjection, paths: ["tax_region", "rules"], relationFilters: [], ordering: new Map(), withDeleted: false,
        query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: active({ kind: "and", children: [
          { kind: "in", column: "tax_region_id", values: [...regionIds] }, { kind: "or", children: alternatives }] }) },
        window: { kind: "catalog", order: "id", select: orderedCatalog("asc") } } satisfies ReadPlan;
    };
    const readRegions = Effect.fn("Tax.readRegions")(function* (ctx: CommerceRelationReadContext, input: unknown) {
      const parsed = yield* Effect.fromResult(prepareTaxRegionQuery(input));
      return yield* executeRead(ctx, catalog, regionPlan(parsed), false);
    });
    const readRates = Effect.fn("Tax.readCandidateRates")(function* (ctx: CommerceRelationReadContext, input: unknown) {
      const parsed = yield* Effect.fromResult(prepareTaxRateQuery(input));
      const regionalRates = yield* readCommerceRelationRows(ctx, rate.name, regionalRatePredicate(parsed.regionIds));
      const regionalIds: string[] = [];
      for (const candidate of regionalRates) {
        if (typeof candidate.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
        regionalIds.push(candidate.id);
      }
      // Full Rules are checked even when a matching selector would return fewer.
      const ruleCohort = ruleCohortPredicate(regionalIds);
      yield* readCommerceRelationRows(ctx, rule.name, ruleCohort);
      const matchingRules = parsed.rulePredicate === undefined ? undefined : yield* resolveCommerceRelationFilter(ctx, rate.name, "rules",
        { kind: "and", children: [ruleCohort, parsed.rulePredicate] }, catalog.relations);
      return yield* executeRead(ctx, catalog, candidatePlan(parsed.regionIds, matchingRules), false);
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = (read: typeof readRegions): DAL.RepositoryService["find"] => (input, shared) => bound.bridge.executeInput(shared, input,
        (ctx, captured) => bound.bridge.checked(ctx, Effect.gen(function* () {
          const value = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources));
          const result = yield* read({ manager: ctx.manager, table: ctx.table, resources: ctx.resources, admitSelection: admission }, value);
          return structuredClone(result.rows);
        })));
      const regionRepository: DAL.RepositoryService = { ...denied, find: find(readRegions) };
      const rateRepository: DAL.RepositoryService = { ...denied, find: find(readRates) };
      return { ...bound, repository: denied, denied, regionRepository, rateRepository };
    };
    return { bind, catalog, admission, readRegions, readRates, region, rate, rule, provider, relations,
      regionPlan, candidatePlan, regionalRatePredicate, ruleCohortPredicate,
      contracts: { decodeRegion, decodeRate, decodeRule }, queryRegion: prepareTaxRegionQuery, queryRate: prepareTaxRateQuery };
  });
}
