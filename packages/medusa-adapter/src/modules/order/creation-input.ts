import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ExactNumericRaw } from "../../value/exact-numeric";

const Amount = Schema.Union([Schema.String, Schema.Finite, Schema.Struct(ExactNumericRaw.fields)]);
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const Json = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
const LineItem = Schema.Struct({
  title: Schema.String, quantity: Amount, unit_price: Amount,
  subtitle: Text, thumbnail: Text, product_id: Text, product_title: Text, product_description: Text,
  product_subtitle: Text, product_type: Text, product_type_id: Text, product_collection: Text, product_handle: Text,
  variant_id: Text, variant_sku: Text, variant_barcode: Text, variant_title: Text, variant_option_values: Json,
  requires_shipping: Schema.Literal(false), is_discountable: Schema.optionalKey(Schema.Boolean),
  is_giftcard: Schema.optionalKey(Schema.Boolean), is_tax_inclusive: Schema.optionalKey(Schema.Boolean),
  is_custom_price: Schema.optionalKey(Schema.Boolean), compare_at_unit_price: Schema.optionalKey(Schema.NullOr(Amount)),
  metadata: Json, cart_id: Text,
  tax_lines: Schema.optionalKey(Schema.Array(Schema.Never)), adjustments: Schema.optionalKey(Schema.Array(Schema.Never)),
});

/** Initial checkout prerequisite: native creation of digital/manual-item Orders.
 * The complete schema remains installed; shipping, Address creation, discounts,
 * tax lines and credit-line writes need their own connected admission. */
export const OrderCreates = Schema.Array(Schema.Struct({
  currency_code: Schema.String,
  items: Schema.optionalKey(Schema.Array(LineItem).check(Schema.isMaxLength(4))),
  region_id: Text, customer_id: Text, sales_channel_id: Text, email: Text, locale: Text,
  status: Schema.optionalKey(Schema.Literal("pending")), metadata: Json,
  no_notification: Schema.optionalKey(Schema.Boolean),
  shipping_address: Schema.optionalKey(Schema.Null), billing_address: Schema.optionalKey(Schema.Null),
  shipping_methods: Schema.optionalKey(Schema.Array(Schema.Never)), credit_lines: Schema.optionalKey(Schema.Array(Schema.Never)),
  promo_codes: Schema.optionalKey(Schema.Array(Schema.Never)),
})).check(Schema.isLengthBetween(1, 4), Schema.makeFilter(orders =>
  orders.reduce((sum, order) => sum + (order.items?.length ?? 0), 0) <= 4 || "Expected at most four total Order line items"));
export const decodeOrderCreates = commerceDecoder(OrderCreates, "invalidInput");
