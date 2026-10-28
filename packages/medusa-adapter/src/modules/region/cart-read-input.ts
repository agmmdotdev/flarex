import { Result, Schema, type Effect } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import type { CommerceRelations } from "../../query/relations";
import { compileRegionReadContracts, regionReadLimit } from "./input";
import type { captureRegionMetadata } from "./schema";

// A Store default is forwarded to Query even when it is an empty string. Keep
// selector admission distinct from validation of actual stored Region IDs.
export const RegionCartId = Schema.String.check(Schema.isMaxLength(256));
export const RegionCartFilters = Schema.Struct({ id: Schema.optionalKey(Schema.Union([Schema.Null, RegionCartId,
  Schema.Array(RegionCartId).check(Schema.isMaxLength(regionReadLimit))])) });
export const RegionCartReadConfig = Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 64))),
  relations: Schema.optionalKey(Schema.Array(Schema.Literal("countries")).check(Schema.isMaxLength(1))),
  take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
});
export const RegionCartReadInput = Schema.Struct({ filters: Schema.optionalKey(RegionCartFilters), config: Schema.optionalKey(RegionCartReadConfig) });
export const decodeRegionCartReadInput = commerceDecoder(RegionCartReadInput, "invalidInput");
export const regionCartCountryLimit = commerceLimits.catalogRows;
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(regionReadLimit)), "storedCorruption");
const decodeCountries = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(regionCartCountryLimit)), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureRegionMetadata>>["frame"];

/** This Cart reader extends the checked Region owner with the actual native
 * Country identity. It does not reinterpret Country.iso_2 as a generated id. */
export function compileRegionCartReadContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const region = yield* compileRegionReadContracts(metadata), country = metadata.tables.find(table => table.name === "region_country");
    if (country === undefined || country.columns.filter(column => column.primaryKey).length !== 1 ||
      country.columns.find(column => column.name === "iso_2")?.primaryKey !== true || country.columns.find(column => column.name === "iso_2")?.type !== "text")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const countries = describeToManyRelation(region.table, "countries", metadata.tables);
    if (countries?.targetTable !== country.name || countries.sourcePrimaryKeys.length !== 1 || countries.sourcePrimaryKeys[0] !== "id" ||
      countries.targetPrimaryKeys.length !== 1 || countries.targetPrimaryKeys[0] !== "iso_2" || countries.join.type !== "hasMany" ||
      countries.join.foreignKeys.length !== 1 || countries.join.foreignKeys[0] !== "region_id") return yield* Result.fail(commerceError("unsupportedProfile"));
    const completeCountry = yield* compileCompleteRow(country), projectedCountry = yield* compileRowProjection(country), projectedRegion = yield* compileRowProjection(region.table);
    const decodeCountry = (input: unknown) => Result.gen(function* () {
      const row = yield* completeCountry(input);
      if (typeof row.iso_2 !== "string" || row.iso_2.length === 0 || row.iso_2.length > 256) return yield* Result.fail(commerceError("storedCorruption"));
      return { ...row, iso_2: row.iso_2 };
    });
    const decodeProjection = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeRows(input), seen = new Set<string>();
      for (const value of rows) {
        const { countries: nested, ...scalar } = value, row = yield* projectedRegion(scalar);
        if (typeof row.id !== "string" || row.id.length === 0 || seen.has(row.id) || row.deleted_at !== undefined && row.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        seen.add(row.id);
        if (nested !== undefined) {
          const identities = new Set<string>();
          for (const member of yield* decodeCountries(nested)) {
            const child = yield* projectedCountry(member);
            if (typeof child.iso_2 !== "string" || child.iso_2.length === 0 || identities.has(child.iso_2) ||
              child.deleted_at !== undefined && child.deleted_at !== null || child.region_id !== undefined && child.region_id !== row.id)
              return yield* Result.fail(commerceError("storedCorruption"));
            identities.add(child.iso_2);
          }
        }
      }
      return rows;
    });
    const relations: CommerceRelations = new Map([[region.table.name, new Map([["countries", countries]])]]);
    return { ...region, country, countries: { ...countries, join: countries.join }, relations, decodeCountry, decodeProjection };
  });
}
