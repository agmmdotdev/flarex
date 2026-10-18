import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import type { captureRegionMetadata } from "./schema";

export const RegionId = Schema.String.check(Schema.isLengthBetween(1, 256));
export const regionReadLimit = 8;
export const RegionFilters = Schema.Struct({ id: Schema.Union([RegionId, Schema.Array(RegionId).check(Schema.isMaxLength(regionReadLimit))]) });
export const RegionReadConfig = Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 16),
  Schema.makeFilter(fields => fields.includes("id") || "Expected the Region identity in a selected read"))),
  relations: Schema.optionalKey(Schema.Array(Schema.Never)), take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
});
export const RegionReadInput = Schema.Struct({ filters: RegionFilters, config: Schema.optionalKey(RegionReadConfig) });
export const decodeRegionReadInput = commerceDecoder(RegionReadInput, "invalidInput");
const decodeProjectionObject = commerceDecoder(Schema.JsonObject, "storedCorruption");
const decodeObjects = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(regionReadLimit)), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureRegionMetadata>>["frame"];

export function compileRegionReadContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "region");
    if (metadata.tables.length !== 2 || table === undefined || table.columns.filter(column => column.primaryKey).length !== 1 ||
      table.columns.find(column => column.name === "id")?.options?.prefix !== "reg" ||
      table.columns.find(column => column.name === "automatic_taxes")?.defaultValue !== true)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table), projected = yield* compileRowProjection(table);
    const decodeRow = (input: unknown) => Result.gen(function* () {
      const row = yield* complete(input);
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256) return yield* Result.fail(commerceError("storedCorruption"));
      return { ...row, id: row.id };
    });
    const decodeProjection = (input: unknown) => Result.gen(function* () {
      const result: JsonObject[] = [], seen = new Set<string>();
      for (const value of yield* decodeObjects(input)) {
        const row = yield* projected(value);
        if (typeof row.id !== "string" || row.id.length === 0 || seen.has(row.id) || row.deleted_at !== undefined && row.deleted_at !== null)
          return yield* Result.fail(commerceError("storedCorruption"));
        seen.add(row.id); result.push(yield* decodeProjectionObject(row));
      }
      return result;
    });
    return { table, decodeRow, decodeProjection };
  });
}
