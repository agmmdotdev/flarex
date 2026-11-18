import { Schema } from "effect";
import { ScalarId } from "../../repository/scalar-id-read";

const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
export const StockLocationAddressInput = Schema.Struct({ id: Schema.optionalKey(ScalarId),
  address_1: Schema.String, country_code: Schema.String, address_2: Text, company: Text,
  city: Text, phone: Text, province: Text, postal_code: Text,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
export const StockLocationInput = Schema.Struct({ id: Schema.optionalKey(ScalarId), name: Schema.String,
  address_id: Schema.optionalKey(Schema.NullOr(ScalarId)), address: Schema.optionalKey(StockLocationAddressInput),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
export const StockLocationsInput = Schema.Array(StockLocationInput).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const StockLocationsOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: ScalarId, name: Schema.String }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
