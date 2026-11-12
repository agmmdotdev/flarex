import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import { ExactNumericRaw } from "../../value/exact-numeric";

const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const Metadata = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
export const CartRefreshIds = Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const TaxFields = { code: Schema.String, rate: Schema.Finite, description: Text, provider_id: Text, tax_rate_id: Text, metadata: Metadata };
export const CartItemTaxLine = Schema.Struct({ ...TaxFields, item_id: ScalarId });
export const CartItemTaxLines = Schema.Array(CartItemTaxLine).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartShippingTaxLine = Schema.Struct({ ...TaxFields, shipping_method_id: ScalarId });
export const CartShippingTaxLines = Schema.Array(CartShippingTaxLine).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const AdjustmentFields = {
  amount: Schema.Union([Schema.String, Schema.Finite, Schema.Struct(ExactNumericRaw.fields)]), code: Text,
  description: Text, provider_id: Text, promotion_id: Text, metadata: Metadata };
export const CartItemAdjustments = Schema.Array(Schema.Struct({ ...AdjustmentFields, item_id: ScalarId,
  is_tax_inclusive: Schema.optionalKey(Schema.Boolean) })).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartShippingAdjustments = Schema.Array(Schema.Struct({ ...AdjustmentFields, shipping_method_id: ScalarId }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartItemTaxRead = Schema.Struct({ item_id: CartRefreshIds });
export const CartShippingTaxRead = Schema.Struct({ shipping_method_id: CartRefreshIds });
export const CartSetItemTaxInput = Schema.Struct({ cart_id: ScalarId, tax_lines: CartItemTaxLines });
export const CartSetShippingTaxInput = Schema.Struct({ cart_id: ScalarId, tax_lines: CartShippingTaxLines });
export const decodeCartRefreshIds = commerceDecoder(CartRefreshIds, "invalidInput");
export const decodeCartItemAdjustments = commerceDecoder(CartItemAdjustments, "invalidInput");
export const decodeCartItemTaxRead = commerceDecoder(CartItemTaxRead, "invalidInput");
export const decodeCartShippingTaxRead = commerceDecoder(CartShippingTaxRead, "invalidInput");
export const decodeCartSetItemTaxInput = commerceDecoder(CartSetItemTaxInput, "invalidInput");
export const decodeCartSetShippingTaxInput = commerceDecoder(CartSetShippingTaxInput, "invalidInput");
export const decodeCartShippingAdjustments = commerceDecoder(CartShippingAdjustments, "invalidInput");
