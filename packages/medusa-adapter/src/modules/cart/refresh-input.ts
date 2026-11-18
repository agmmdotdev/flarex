import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import { ExactNumericRaw } from "../../value/exact-numeric";

const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const Metadata = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
export const CartRefreshIds = Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartItemTaxLines = Schema.Array(Schema.Struct({ code: Schema.String, rate: Schema.Finite, item_id: ScalarId,
  description: Text, provider_id: Text, tax_rate_id: Text, metadata: Metadata })).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartEmptyShippingTaxLines = Schema.Array(Schema.Never).pipe(Schema.mutable).check(Schema.isMaxLength(0));
export const CartEmptyShippingAdjustments = Schema.Array(Schema.Never).pipe(Schema.mutable).check(Schema.isMaxLength(0));
export const CartItemAdjustments = Schema.Array(Schema.Struct({ item_id: ScalarId,
  amount: Schema.Union([Schema.String, Schema.Finite, Schema.Struct(ExactNumericRaw.fields)]), code: Text,
  description: Text, provider_id: Text, promotion_id: Text, metadata: Metadata,
  is_tax_inclusive: Schema.optionalKey(Schema.Boolean) })).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartItemTaxRead = Schema.Struct({ item_id: CartRefreshIds });
export const CartShippingTaxRead = Schema.Struct({ shipping_method_id: CartRefreshIds });
export const CartSetItemTaxInput = Schema.Struct({ cart_id: ScalarId, tax_lines: CartItemTaxLines });
export const CartSetShippingTaxInput = Schema.Struct({ cart_id: ScalarId, tax_lines: CartEmptyShippingTaxLines });
export const decodeCartRefreshIds = commerceDecoder(CartRefreshIds, "invalidInput");
export const decodeCartItemAdjustments = commerceDecoder(CartItemAdjustments, "invalidInput");
export const decodeCartItemTaxRead = commerceDecoder(CartItemTaxRead, "invalidInput");
export const decodeCartShippingTaxRead = commerceDecoder(CartShippingTaxRead, "invalidInput");
export const decodeCartSetItemTaxInput = commerceDecoder(CartSetItemTaxInput, "invalidInput");
export const decodeCartSetShippingTaxInput = commerceDecoder(CartSetShippingTaxInput, "invalidInput");
export const decodeCartEmptyShippingAdjustments = commerceDecoder(CartEmptyShippingAdjustments, "invalidInput");
