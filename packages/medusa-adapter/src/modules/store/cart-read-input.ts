import { Result, Schema, type Effect } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import type { captureStoreMetadata } from "./schema";

// The Cart context branch reads the complete active Store cohort. Its native
// default selection and graph pagination are the only admitted selectors.
export const StoreCartReadFilters = Schema.Record(Schema.String, Schema.Never);
export const StoreCartReadConfig = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 256))),
  relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
});
export const StoreCartReadInput = Schema.Struct({ filters: Schema.optionalKey(StoreCartReadFilters), config: Schema.optionalKey(StoreCartReadConfig) });
export const decodeStoreCartRead = commerceDecoder(StoreCartReadInput, "invalidInput");
export const decodeStoreCartReadArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([]), Schema.Tuple([Schema.Union([StoreCartReadFilters, Schema.Undefined])]),
  Schema.Tuple([Schema.Union([StoreCartReadFilters, Schema.Undefined]), Schema.Union([StoreCartReadConfig, Schema.Undefined])]),
]), "invalidInput");
const decodeRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(256)), "storedCorruption");

export function compileStoreCartReadContracts(metadata: Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"]) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "store");
    if (metadata.tables.length !== 3 || table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeRow = yield* compileCompleteRow(table), decodeProjection = yield* compileRowProjection(table);
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeRowsShape(input);
      for (const row of rows) yield* decodeProjection(row);
      return rows;
    });
    return { table, decodeRow, decodeRows };
  });
}
