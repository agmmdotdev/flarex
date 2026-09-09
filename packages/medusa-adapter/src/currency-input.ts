import { Result, Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileKeyedUpdates } from "./write/keyed";

export const decodeCurrencyRead = commerceDecoder(Schema.Struct({
  code: Schema.optionalKey(Schema.String), filters: Schema.optionalKey(Schema.Json), config: Schema.optionalKey(Schema.Json),
}), "invalidInput");
const decodeChanges = commerceDecoder(Schema.Array(Schema.Json), "invalidInput");
const decodeChange = commerceDecoder(Schema.StructWithRest(Schema.Struct({
  entity: Schema.StructWithRest(Schema.Struct({ code: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
  update: Schema.StructWithRest(Schema.Struct({ code: Schema.optionalKey(Schema.Never) }), [Schema.Record(Schema.String, Schema.Json)]),
}), [Schema.Record(Schema.String, Schema.Json)]), "invalidInput");

export const currencyUpdateRows = compileKeyedUpdates({
  keyColumn: "code",
  repeatedKeys: "preserve",
  decodeEntries: decodeChanges,
  readEntry: (value: Json) => decodeChange(value).pipe(
    Result.map(change => ({ key: change.entity.code, update: change.update })),
  ),
});
