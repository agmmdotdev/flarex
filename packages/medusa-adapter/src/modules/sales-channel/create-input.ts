import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** The native create DTO admitted by the Sales Channel workflow method.
 * Optional fields remain omitted so the native DML/DAL owns defaults. The
 * Product association consumer retains its separate id/name-only contract. */
export const SalesChannelCreateInput = Schema.Struct({
  id: Schema.optionalKey(Id),
  name: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  is_disabled: Schema.optionalKey(Schema.Boolean),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
const decodeArguments = commerceDecoder(Schema.Tuple([
  Schema.Array(SalesChannelCreateInput).check(Schema.isMaxLength(256)),
]), "invalidInput");
export const SalesChannelCreatedRow = Schema.StructWithRest(
  Schema.Struct({ id: Id, name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
);
const decodeRowArray = commerceDecoder(Schema.Array(SalesChannelCreatedRow).check(Schema.isMaxLength(256)), "storedCorruption");

/** Checked DML supplies the complete native return contract, including implicit
 * lifecycle columns. The finite root separately chooses its four-row bound;
 * shared service workflow calls keep the existing 256-row ceiling. */
export function compileSalesChannelCreateContracts(table: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "sales_channel" ||
      Object.keys(SalesChannelCreateInput.fields).some(name => !table.columns.some(column => column.name === name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeCompleteRow = yield* compileCompleteRow(table);
    const decodeRows = (input: unknown) => decodeRowArray(input).pipe(Result.flatMap(rows => Result.gen(function* () {
      for (const row of rows) yield* decodeCompleteRow(row);
      return rows;
    })));
    return { decodeArguments, decodeRows };
  });
}
