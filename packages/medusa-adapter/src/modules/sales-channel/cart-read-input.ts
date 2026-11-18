import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const decodeSalesChannelCartRead = commerceDecoder(Schema.Struct({ id: Id }), "invalidInput");
export const decodeSalesChannelCartReadArguments = commerceDecoder(Schema.Tuple([Id]), "invalidInput");

/** The native Cart step supplies one ID and omits configuration. Decode the
 * entire scalar result from checked DML before the next native step uses it. */
export function compileSalesChannelCartReadContracts(table: SchemaTable) {
  return Result.gen(function* () {
    const primary = table.columns.filter(column => column.primaryKey);
    if (table.name !== "sales_channel" || primary.length !== 1 || primary[0]?.name !== "id" || primary[0].type !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return { decodeRow: yield* compileCompleteRow(table) };
  });
}
