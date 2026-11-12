import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { ScalarId } from "../../repository/scalar-id-read";
import { CartMutationIds } from "./mutation-input";

const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const Metadata = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
const Amount = Schema.Union([Schema.String, Schema.Finite, Schema.Struct(ExactNumericRaw.fields)]);
const fields = { description: Schema.optionalKey(Schema.Json), shipping_option_id: Text, data: Metadata, metadata: Metadata,
  is_tax_inclusive: Schema.optionalKey(Schema.Boolean) };
export const CartShippingMethodCreates = Schema.Array(Schema.Struct({ ...fields, cart_id: ScalarId, name: Schema.String, amount: Amount }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartShippingMethodUpdates = Schema.Array(Schema.Struct({ ...fields, id: ScalarId,
  name: Schema.optionalKey(Schema.String), amount: Schema.optionalKey(Amount) })).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartShippingMethodFilters = Schema.Struct({ id: Schema.optionalKey(Schema.Union([ScalarId, CartMutationIds])),
  cart_id: Schema.optionalKey(ScalarId) });
export const CartShippingMethodRead = Schema.Struct({ filters: CartShippingMethodFilters,
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
    relations: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
    take: Schema.optionalKey(Schema.Literals([4, 15, 256])), skip: Schema.optionalKey(Schema.Literal(0)),
    order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) })) });
export const decodeCartShippingMethodCreates = commerceDecoder(CartShippingMethodCreates, "invalidInput");
export const decodeCartShippingMethodUpdates = commerceDecoder(CartShippingMethodUpdates, "invalidInput");
export const decodeCartShippingMethodRead = commerceDecoder(CartShippingMethodRead, "invalidInput");
