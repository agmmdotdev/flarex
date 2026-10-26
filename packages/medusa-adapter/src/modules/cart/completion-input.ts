import { Schema } from "effect";
import { ScalarId } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";

// Native updateCartsStep restores these scalar preimages. This profile changes
// completed_at only; every supplied retained field must match its stored value.
export const CartCompletionPatch = Schema.Struct({ id: ScalarId, completed_at: Schema.NullOr(Schema.String),
  region_id: Schema.optionalKey(Schema.NullOr(ScalarId)), customer_id: Schema.optionalKey(Schema.NullOr(ScalarId)),
  sales_channel_id: Schema.optionalKey(Schema.NullOr(ScalarId)), email: Schema.optionalKey(Schema.NullOr(Schema.String)),
  currency_code: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)) });
export const CartCompletionUpdates = Schema.Array(CartCompletionPatch).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 1));
export const EmptyCartAddresses = Schema.Array(Schema.Never).pipe(Schema.mutable);
export const EmptyCartAddressRead = Schema.Struct({ filters: Schema.Struct({ id: EmptyCartAddresses }),
  config: Schema.optionalKey(Schema.Struct({})) });
export const decodeCartCompletionUpdates = commerceDecoder(CartCompletionUpdates, "invalidInput");
export const decodeEmptyCartAddressRead = commerceDecoder(EmptyCartAddressRead, "invalidInput");
export const decodeEmptyCartAddresses = commerceDecoder(EmptyCartAddresses, "invalidInput");
