import { Result, Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";

export const decodeCurrencyRead = commerceDecoder(Schema.Struct({
  code: Schema.optionalKey(Schema.String), filters: Schema.optionalKey(Schema.Json), config: Schema.optionalKey(Schema.Json),
}), "invalidInput");
const decodeChanges = commerceDecoder(Schema.Array(Schema.Json), "invalidInput");
const decodeChange = commerceDecoder(Schema.StructWithRest(Schema.Struct({
  entity: Schema.StructWithRest(Schema.Struct({ code: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
  update: Schema.StructWithRest(Schema.Struct({ code: Schema.optionalKey(Schema.Never) }), [Schema.Record(Schema.String, Schema.Json)]),
}), [Schema.Record(Schema.String, Schema.Json)]), "invalidInput");

export const currencyUpdateRows = (input: Json) => Result.gen(function* () {
  const rows = [];
  for (const value of yield* decodeChanges(input)) {
    const change = yield* decodeChange(value);
    rows.push({ ...change.update, code: change.entity.code });
  }
  return rows;
});
