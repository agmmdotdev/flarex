import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { decodeOptionalServiceResult } from "../../module/result";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import { NativePreimageConfig } from "../../workflow/preimage";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Array(Id).check(Schema.isMaxLength(4));
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const Metadata = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
export const StockLocationUpdateSelector = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, Ids])),
  name: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(4))])),
});
export const StockLocationAddressSelector = Schema.Struct({ id: StockLocationUpdateSelector.fields.id });
/** Patch nullability follows checked Address DML. Creation validates the merged
 * complete row in its own branch; attached addresses permit partial updates. */
export const StockLocationAddressPatch = Schema.Struct({
  address_1: Schema.optionalKey(Schema.String), country_code: Schema.optionalKey(Schema.String),
  address_2: Text, company: Text, city: Text, phone: Text, province: Text, postal_code: Text, metadata: Metadata,
});
export const StockLocationAddressUpsert = Schema.Struct({ id: Schema.optionalKey(Id), ...StockLocationAddressPatch.fields });
export const StockLocationAddressUpserts = Schema.Array(StockLocationAddressUpsert).check(Schema.isMaxLength(4));
export const StockLocationUpdateData = Schema.Struct({ name: Schema.optionalKey(Schema.String), metadata: Metadata,
  address_id: Schema.optionalKey(Schema.NullOr(Id)), address: Schema.optionalKey(StockLocationAddressPatch) });
export const StockLocationRootUpdate = Schema.Struct({ name: StockLocationUpdateData.fields.name, metadata: Metadata });
export const StockLocationUpdateInput = Schema.Struct({ selector: StockLocationUpdateSelector, update: StockLocationUpdateData });
export const StockLocationRootUpdateInput = Schema.Struct({ selector: StockLocationUpdateSelector, update: StockLocationRootUpdate });
export const StockLocationReadConfig = Schema.Struct({
  select: NativePreimageConfig.fields.select, relations: NativePreimageConfig.fields.relations,
  skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
export const StockLocationUpdateReadInput = Schema.Struct({ filters: Schema.optionalKey(StockLocationUpdateSelector), config: Schema.optionalKey(StockLocationReadConfig) });
export const StockLocationAddressReadInput = Schema.Struct({ filters: Schema.optionalKey(StockLocationAddressSelector), config: Schema.optionalKey(StockLocationReadConfig) });
export const StockLocationUpdateRow = Schema.Struct({ id: Id, name: Schema.String, metadata: Schema.NullOr(Schema.JsonObject),
  address_id: Schema.NullOr(Id), created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });
export const StockLocationUpdateWorkflowOutput = Schema.NullOr(StockLocationUpdateRow);
export const decodeStockLocationUpdateInput = commerceDecoder(StockLocationUpdateInput, "invalidInput");
export const decodeStockLocationRootUpdateInput = commerceDecoder(StockLocationRootUpdateInput, "invalidInput");
export const decodeStockLocationAddressUpserts = commerceDecoder(StockLocationAddressUpserts, "invalidInput");

export function compileStockLocationUpdateContracts(table: SchemaTable, address: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "stock_location" || address.name !== "stock_location_address" ||
      Object.keys(StockLocationRootUpdate.fields).some(name => !table.columns.some(column => column.name === name)) ||
      Object.keys(StockLocationAddressPatch.fields).some(name => !address.columns.some(column => column.name === name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table), addressComplete = yield* compileCompleteRow(address);
    const projection = yield* compileRowProjection(table), addressProjection = yield* compileRowProjection(address);
    const decodeShape = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }),
      [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "storedCorruption");
    const preimages = (decode: typeof projection) => (input: unknown) => decodeShape(input).pipe(Result.flatMap(rows => Result.gen(function* () {
      for (const row of rows) yield* decode(row);
      return rows;
    })));
    const decodeOutput = (input: Parameters<typeof decodeOptionalServiceResult>[0]) => decodeOptionalServiceResult(input).pipe(Result.flatMap(value =>
      value === undefined ? Result.succeed(undefined) : complete(value)));
    const decodeAddresses = (input: unknown) => decodeShape(input).pipe(Result.flatMap(rows => Result.gen(function* () {
      for (const row of rows) yield* addressComplete(row);
      return rows;
    })));
    return { decodePreimages: preimages(projection), decodeAddressPreimages: preimages(addressProjection), decodeOutput, decodeAddresses };
  });
}
