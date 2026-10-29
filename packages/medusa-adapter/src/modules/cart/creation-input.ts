import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ExactNumericRaw } from "../../value/exact-numeric";

const Text = Schema.optionalKey(Schema.String), Json = Schema.optionalKey(Schema.JsonObject);
const Amount = Schema.Union([Schema.String, Schema.Finite, Schema.Struct(ExactNumericRaw.fields)]);
export const CartCreationAddress = Schema.Struct({ customer_id: Text, company: Text, first_name: Text, last_name: Text, address_1: Text, address_2: Text,
  city: Text, country_code: Text, province: Text, postal_code: Text, phone: Text, metadata: Json });
const Tax = Schema.Struct({ id: Text, code: Schema.String, rate: Schema.Finite, description: Text, provider_id: Text,
  tax_rate_id: Text, metadata: Json });
const Adjustment = Schema.Struct({ id: Text, amount: Amount, description: Text, code: Schema.String, provider_id: Text,
  promotion_id: Text, is_tax_inclusive: Schema.optionalKey(Schema.Boolean), metadata: Json });
const Line = Schema.Struct({ id: Text, title: Schema.String, quantity: Schema.Finite, unit_price: Amount,
  subtitle: Text, thumbnail: Text, product_id: Text, product_title: Text, product_description: Text,
  product_subtitle: Text, product_type: Text, product_type_id: Text, product_collection: Text, product_handle: Text,
  variant_id: Text, variant_sku: Text, variant_barcode: Text, variant_title: Text, variant_option_values: Json,
  requires_shipping: Schema.optionalKey(Schema.Boolean), is_discountable: Schema.optionalKey(Schema.Boolean),
  is_giftcard: Schema.optionalKey(Schema.Boolean), is_tax_inclusive: Schema.optionalKey(Schema.Boolean),
  is_custom_price: Schema.optionalKey(Schema.Boolean), compare_at_unit_price: Schema.optionalKey(Amount), metadata: Json,
  tax_lines: Schema.optionalKey(Schema.Array(Tax).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
  adjustments: Schema.optionalKey(Schema.Array(Adjustment).pipe(Schema.mutable).check(Schema.isMaxLength(4))) });
export const CartCreates = Schema.Array(Schema.Struct({ id: Text, currency_code: Schema.String, region_id: Text, customer_id: Text,
  sales_channel_id: Text, email: Text, locale: Text, metadata: Json, shipping_address_id: Text, billing_address_id: Text,
  shipping_address: Schema.optionalKey(Schema.Union([CartCreationAddress, Schema.String])),
  billing_address: Schema.optionalKey(Schema.Union([CartCreationAddress, Schema.String])),
  items: Schema.optionalKey(Schema.Array(Line).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
})).pipe(Schema.mutable).check(Schema.isMaxLength(4), Schema.makeFilter(carts => {
  const lines = carts.flatMap(cart => cart.items ?? []);
  return lines.length <= 4 && lines.reduce((count, line) => count + (line.tax_lines?.length ?? 0), 0) <= 4 &&
    lines.reduce((count, line) => count + (line.adjustments?.length ?? 0), 0) <= 4 || "Cart creation admits four total lines, tax lines and adjustments";
}));
// The genuine complete root supplies native nullable DTO members (including
// absent Product type/collection and a Customer's nullable email). Keep that
// direct-child contract separate from the already admitted standalone input.
const NullableText = Schema.optionalKey(Schema.NullOr(Schema.String));
const NullableJson = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
const RootAddress = Schema.Struct({ ...CartCreationAddress.fields, customer_id: NullableText, company: NullableText,
  first_name: NullableText, last_name: NullableText, address_1: NullableText, address_2: NullableText,
  city: NullableText, country_code: NullableText, province: NullableText, postal_code: NullableText, phone: NullableText, metadata: NullableJson });
const RootLine = Schema.Struct({ ...Line.fields, subtitle: NullableText, thumbnail: NullableText, product_id: NullableText,
  product_title: NullableText, product_description: NullableText, product_subtitle: NullableText, product_type: NullableText,
  product_type_id: NullableText, product_collection: NullableText, product_handle: NullableText, variant_id: NullableText,
  variant_sku: NullableText, variant_barcode: NullableText, variant_title: NullableText,
  variant_option_values: NullableJson, metadata: NullableJson,
  // Initial Tax and Adjustment creation belongs to the root's genuine child
  // workflows, after the separate native Line Item insertion.
  tax_lines: Schema.optionalKey(Schema.Array(Schema.Never).pipe(Schema.mutable).check(Schema.isMaxLength(0))),
  adjustments: Schema.optionalKey(Schema.Array(Schema.Never).pipe(Schema.mutable).check(Schema.isMaxLength(0))) });
export const CartRootCreates = Schema.Array(Schema.Struct({ id: Text, currency_code: Schema.String,
  promo_codes: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(4))), additional_data: Json,
  region_id: NullableText, customer_id: NullableText, sales_channel_id: NullableText, email: NullableText, locale: NullableText,
  metadata: NullableJson, shipping_address_id: NullableText, billing_address_id: NullableText,
  shipping_address: Schema.optionalKey(Schema.Union([RootAddress, Schema.String])),
  billing_address: Schema.optionalKey(Schema.Union([RootAddress, Schema.String])),
  items: Schema.optionalKey(Schema.Array(RootLine).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
})).pipe(Schema.mutable).check(Schema.isMaxLength(4), Schema.makeFilter(carts =>
  carts.reduce((count, cart) => count + (cart.items?.length ?? 0), 0) <= 4 || "Cart creation admits four total lines"));
export const CartCreationReceipt = Schema.Struct({ operation_id: Schema.String.check(Schema.isLengthBetween(1, 256)) });
export const decodeCartCreates = commerceDecoder(CartCreates, "invalidInput");
export const decodeCartRootCreates = commerceDecoder(CartRootCreates, "invalidInput");
export const decodeCartCreationReceipt = commerceDecoder(CartCreationReceipt, "invalidInput");
export const decodeCartCreationResult = commerceDecoder(Schema.Struct({ carts: Schema.Array(Schema.JsonObject).pipe(Schema.mutable).check(Schema.isMaxLength(4)),
  receipt: Schema.optionalKey(CartCreationReceipt) }), "storedCorruption");
export const decodeCartCreationCompensation = commerceDecoder(Schema.Struct({ status: Schema.Literals(["compensated", "alreadyCompensated"]),
  deletedCartIds: Schema.Array(Schema.String), deletedAddressIds: Schema.Array(Schema.String), retainedAddressIds: Schema.Array(Schema.String) }), "storedCorruption");
