import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** Raw order and repeats belong to the workflow; native DAL root selection is
 * membership-based and its returned identities drive Link cleanup. */
export const StockLocationDeletionIds = Schema.Array(Id).check(Schema.isMaxLength(4));
export const decodeStockLocationDeletionIds = commerceDecoder(StockLocationDeletionIds, "invalidInput");
export const decodeStockLocationDeletionArguments = commerceDecoder(Schema.Tuple([StockLocationDeletionIds]), "invalidInput");
const decodeOutput = commerceDecoder(Schema.Struct({
  stock_location_id: Schema.optionalKey(StockLocationDeletionIds),
  location_id: Schema.optionalKey(StockLocationDeletionIds),
}), "storedCorruption");
/** Both native linkable keys name the same actual Location lifecycle rows. */
export const decodeStockLocationDeletionOutput = (input: unknown) => decodeOutput(input).pipe(Result.flatMap(output => {
  const ids = output.stock_location_id, aliases = output.location_id;
  return (ids === undefined) !== (aliases === undefined) || ids !== undefined &&
    (aliases === undefined || ids.length !== aliases.length || ids.some((id, index) => id !== aliases[index]))
    ? Result.fail(commerceError("storedCorruption")) : Result.succeed(output);
}));

export function compileStockLocationDeletionContracts(table: SchemaTable, address: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "stock_location" || address.name !== "stock_location_address" || table.foreignKeys.length !== 1 ||
      !table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "address_id" &&
        key.referencedTable === address.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id") ||
      !table.columns.some(column => column.name === "deleted_at" && column.type === "dateTime" && column.nullable))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    // Keep the complete two-table native metadata checked even though deletion
    // grants no Address root, scalar write or reverse cascade capability.
    yield* compileCompleteRow(address);
    return { decodeRow: yield* compileCompleteRow(table), decodeOutput: decodeStockLocationDeletionOutput };
  });
}
