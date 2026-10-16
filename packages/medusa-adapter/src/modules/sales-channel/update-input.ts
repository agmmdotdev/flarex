import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { decodeOptionalServiceResult } from "../../module/result";
import { NativePreimageConfig } from "../../workflow/preimage";
import { SalesChannelCreatedRow, SalesChannelCreateInput } from "./create-input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Array(Id).check(Schema.isMaxLength(4));
const Names = Schema.Array(Schema.String).check(Schema.isMaxLength(4));
export const SalesChannelUpdateSelector = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, Ids])),
  name: Schema.optionalKey(Schema.Union([Schema.String, Names])),
  is_disabled: Schema.optionalKey(Schema.Boolean),
});
export const SalesChannelUpdateData = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  description: SalesChannelCreateInput.fields.description,
  is_disabled: SalesChannelCreateInput.fields.is_disabled,
  metadata: SalesChannelCreateInput.fields.metadata,
});
export const SalesChannelUpdateInput = Schema.Struct({ selector: SalesChannelUpdateSelector, update: SalesChannelUpdateData });
export const SalesChannelUpdateReadInput = Schema.Struct({ filters: SalesChannelUpdateSelector, config: NativePreimageConfig });
const SalesChannelUpdatePreimages = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
export const decodeSalesChannelUpdateInput = commerceDecoder(SalesChannelUpdateInput, "invalidInput");

/** Selector/object update returns the native first row, including genuine
 * undefined on zero matches. Only the private command transport is tagged. */
export function compileSalesChannelUpdateContracts(table: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "sales_channel" ||
      Object.keys(SalesChannelUpdateData.fields).some(name => !table.columns.some(column => column.name === name)))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table), projection = yield* compileRowProjection(table);
    const decodePreimageShape = commerceDecoder(SalesChannelUpdatePreimages, "storedCorruption");
    const decodeRow = commerceDecoder(SalesChannelCreatedRow, "storedCorruption");
    const decodePreimages = (input: unknown) => decodePreimageShape(input).pipe(Result.flatMap(rows => Result.gen(function* () {
      for (const row of rows) yield* projection(row);
      return rows;
    })));
    const decodeOutput = (input: Parameters<typeof decodeOptionalServiceResult>[0]) => decodeOptionalServiceResult(input).pipe(Result.flatMap(value =>
      value === undefined ? Result.succeed(undefined) : decodeRow(value).pipe(Result.flatMap(row => complete(row).pipe(Result.map(() => row))))));
    return { decodePreimages, decodeOutput };
  });
}
