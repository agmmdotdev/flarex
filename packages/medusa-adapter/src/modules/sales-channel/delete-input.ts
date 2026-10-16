import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** Requested order and repeats belong to the native workflow. DAL selection
 * has membership semantics and the native module returns selected identities. */
export const SalesChannelDeletionIds = Schema.Array(Id).check(Schema.isMaxLength(4));
export const decodeSalesChannelDeletionIds = commerceDecoder(SalesChannelDeletionIds, "invalidInput");
export const decodeSalesChannelDeletionArguments = commerceDecoder(Schema.Tuple([SalesChannelDeletionIds]), "invalidInput");
const Output = Schema.Struct({ sales_channel_id: Schema.optionalKey(SalesChannelDeletionIds) });
export const decodeSalesChannelDeletionOutput = commerceDecoder(Output, "storedCorruption");

export function compileSalesChannelDeletionContracts(table: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "sales_channel" || table.foreignKeys.length !== 0 ||
      !table.columns.some(column => column.name === "deleted_at" && column.type === "dateTime" && column.nullable))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return { decodeRow: yield* compileCompleteRow(table), decodeOutput: decodeSalesChannelDeletionOutput };
  });
}
