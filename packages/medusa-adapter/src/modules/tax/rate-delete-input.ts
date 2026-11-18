import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import type { captureTaxMetadata } from "./schema";
import { TaxId } from "./query";
import { compileTaxCreationRows } from "./rate-create-input";

// Retain native requested positions, including duplicate, missing and empty IDs.
export const TaxRateDeletionIds = Schema.Array(Schema.String.check(Schema.isMaxLength(256)))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
const affectedIds = (maximum: number) => Schema.Array(TaxId).pipe(Schema.mutable).check(
  Schema.isLengthBetween(1, maximum), Schema.makeFilter(ids => new Set(ids).size === ids.length || "Expected distinct affected identities"));
export const TaxRateDeletionOutput = Schema.Struct({
  tax_rate_id: Schema.optionalKey(affectedIds(4)),
  tax_rate_rule_id: Schema.optionalKey(affectedIds(8)),
});
export const decodeTaxRateDeletionIds = commerceDecoder(TaxRateDeletionIds, "invalidInput");
export const decodeTaxRateDeletionOutput = commerceDecoder(TaxRateDeletionOutput, "storedCorruption");
const decodeId = commerceDecoder(TaxId, "storedCorruption");
const decodeTuple = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  Schema.Struct({ TaxRate: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4))),
    TaxRateRule: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8))) }),
]), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** The complete four-model DML stays installed. Region rows are read support;
 * only Rates and their declared Rule cascade can participate in this lifecycle. */
export function compileTaxRateDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const rows = yield* compileTaxCreationRows(metadata), { rate, rule } = rows;
    const region = rows.tables.find(table => table.name === "tax_region");
    if (region === undefined || !rate.relationships.some(relation => relation.name === "rules" && relation.type === "hasMany" &&
      relation.targetTable === rule.name && relation.cascadeDelete) ||
      rate.relationships.filter(relation => relation.cascadeDelete).length !== 1 || rule.relationships.some(relation => relation.cascadeDelete) ||
      !rate.relationships.some(relation => relation.name === "tax_region" && relation.type === "belongsTo" && relation.targetTable === region.name) ||
      !rate.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "tax_region_id" &&
        key.referencedTable === region.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id") ||
      rate.columns.find(column => column.name === "tax_region_id")?.nullable !== false)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeRegion = yield* compileCompleteRow(region);
    const decodeRegionRow = (input: unknown) => Result.gen(function* () {
      const row = yield* decodeRegion(input), id = yield* decodeId(row.id);
      const captured: JsonObject & Readonly<{ id: string }> = { ...row, id };
      return captured;
    });
    const entities = [
      { table: rate, model: "TaxRate", linkableKey: "tax_rate_id", maximum: 4, decodeRow: rows.decodeRateRow },
      { table: rule, model: "TaxRateRule", linkableKey: "tax_rate_rule_id", maximum: 8, decodeRow: rows.decodeRuleRow },
    ] as const;
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const [rawRoots, rawGroups] = yield* decodeTuple(input), roots: JsonObject[] = [], cascades: Record<string, JsonObject[]> = {};
      for (const value of rawRoots) roots.push(yield* rows.decodeRateRow(value));
      for (const entity of entities) {
        const values = rawGroups[entity.model];
        if (values === undefined) continue;
        const group: JsonObject[] = [], identities = new Set<string>();
        for (const value of values) {
          const row = yield* entity.decodeRow(value);
          if (identities.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
          identities.add(row.id); group.push(row);
        }
        cascades[entity.model] = group;
      }
      if (!jsonEqual(roots, cascades.TaxRate ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      const rootIds = new Set<string>(), regions = new Set<string>();
      for (const row of roots) {
        if (typeof row.id !== "string" || typeof row.tax_region_id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
        rootIds.add(row.id); regions.add(row.tax_region_id);
      }
      if (regions.size > 2) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of cascades.TaxRateRule ?? []) if (typeof row.tax_rate_id !== "string" || !rootIds.has(row.tax_rate_id))
        return yield* Result.fail(commerceError("storedCorruption"));
      return [roots, cascades] satisfies [JsonObject[], Record<string, JsonObject[]>];
    });
    return { ...rows, region, entities, decodeRegionRow, decodeLifecycleResult,
      decodeOutput: decodeTaxRateDeletionOutput, Input: TaxRateDeletionIds, Output: TaxRateDeletionOutput };
  });
}
