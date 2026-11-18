import { Result, Schema } from "effect";
import { PaymentSessionStatus } from "@medusajs/framework/utils/portable";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";
import { completeCartFields } from "../../cart/utils/fields";

const Text = Schema.NullOr(Schema.String), Raw = Schema.Struct({ value: Schema.String, precision: Schema.Finite });
const Json = Schema.Record(Schema.String, Schema.Json);
const ref = Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Json]);
const Address = Schema.StructWithRest(Schema.Struct({ id: Schema.optionalKey(Schema.String) }), [Json]);
const Adjustment = Schema.StructWithRest(Schema.Struct({ amount: Schema.Finite, code: Schema.optionalKey(Text) }), [Json]);
const Variant = Schema.StructWithRest(Schema.Struct({ id: Schema.String, manage_inventory: Schema.Boolean,
  allow_backorder: Schema.Boolean, product: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({
    id: Schema.String, is_giftcard: Schema.Boolean, shipping_profile: Schema.optionalKey(Schema.NullOr(ref)),
  }), [Json]))), inventory_items: Schema.optionalKey(Schema.Array(Schema.JsonObject)) }), [Json]);
const Item = Schema.StructWithRest(Schema.Struct({ id: Schema.String, quantity: Schema.Finite, unit_price: Schema.Finite,
  raw_unit_price: Schema.optionalKey(Raw), title: Schema.String, is_tax_inclusive: Schema.Boolean, requires_shipping: Schema.Boolean,
  variant_id: Text, variant: Schema.optionalKey(Schema.NullOr(Variant)),
  tax_lines: Schema.Array(Schema.JsonObject).pipe(Schema.mutable), adjustments: Schema.Array(Adjustment).pipe(Schema.mutable),
}), [Json]);
const Shipping = Schema.StructWithRest(Schema.Struct({ name: Schema.String, description: Text,
  amount: Schema.Finite, raw_amount: Schema.optionalKey(Raw), is_tax_inclusive: Schema.Boolean,
  shipping_option_id: Text, data: Schema.JsonObject, metadata: Schema.NullOr(Schema.JsonObject),
  tax_lines: Schema.Array(Schema.JsonObject).pipe(Schema.mutable), adjustments: Schema.Array(Adjustment).pipe(Schema.mutable),
}), [Json]);
const Credit = Schema.StructWithRest(Schema.Struct({ amount: Schema.Finite, raw_amount: Raw,
  reference: Text, reference_id: Text, metadata: Schema.NullOr(Schema.JsonObject) }), [Json]);
const Session = Schema.StructWithRest(Schema.Struct({ id: Schema.String,
  status: Schema.Literals(Object.values(PaymentSessionStatus)) }), [Json]);

/** Native Query already authenticates every selected scalar and relation from
 * module metadata. This view checks the root callback's consumed projection;
 * other genuinely selected JSON fields stay present, without a full DTO claim. */
export const CheckoutCartView = Schema.StructWithRest(Schema.Struct({ id: Schema.String, currency_code: Schema.String,
  sales_channel_id: Text, email: Text, locale: Text, metadata: Schema.NullOr(Schema.JsonObject), total: Schema.Finite,
  credit_line_total: Schema.optionalKey(Schema.Finite),
  items: Schema.Array(Item).pipe(Schema.mutable), shipping_methods: Schema.Array(Shipping).pipe(Schema.mutable),
  credit_lines: Schema.Array(Credit).pipe(Schema.mutable),
  shipping_address: Schema.optionalKey(Schema.NullOr(Address)), billing_address: Schema.optionalKey(Schema.NullOr(Address)),
  region: Schema.optionalKey(Schema.NullOr(ref)), customer: Schema.optionalKey(Schema.NullOr(ref)),
  promotions: Schema.optionalKey(Schema.Array(ref).pipe(Schema.mutable)),
  payment_collection: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({ id: Schema.String,
    payment_sessions: Schema.Array(Session).pipe(Schema.mutable) }), [Json]))),
}), [Json]);
export type CheckoutCartView = typeof CheckoutCartView.Type;
export type CheckoutCartQuery = { readonly entity: "cart"; readonly fields: typeof completeCartFields;
  readonly filters: { readonly id: string }; readonly options: { readonly isList: false } };
const cartQuery = Schema.Struct({ entity: Schema.Literal("cart"), fields: Schema.Array(Schema.String).check(Schema.makeFilter(fields =>
  fields.length === completeCartFields.length && fields.every((field, index) => field === completeCartFields[index]) || "Expected native checkout fields")),
  filters: Schema.Struct({ id: Schema.String }), options: Schema.Struct({ isList: Schema.Literal(false) }) });
export const CheckoutOrderCartQuery = Schema.Struct({ entity: Schema.Literal("order_cart"),
  fields: Schema.Tuple([Schema.Literal("cart_id"), Schema.Literal("order_id")]), filters: Schema.Struct({ cart_id: Schema.String }),
  options: Schema.Struct({ isList: Schema.Literal(false) }) });
export const CheckoutOrderCartView = Schema.Struct({ cart_id: Schema.String, order_id: Schema.String });
export const CheckoutShippingQuery = Schema.Struct({ entity: Schema.Literal("shipping_option"),
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("shipping_profile_id")]),
  filters: Schema.Struct({ id: Schema.Array(Text) }), options: Schema.Struct({ cache: Schema.Struct({ enable: Schema.Literal(true) }) }) });
export const CheckoutShippingView = Schema.Struct({ id: Schema.String, shipping_profile_id: Schema.String });
const isCart = Schema.is(cartQuery), isLink = Schema.is(CheckoutOrderCartQuery), isShipping = Schema.is(CheckoutShippingQuery);
const decodeCart = Schema.decodeUnknownResult(Schema.Tuple([CheckoutCartView]));
const decodeLink = Schema.decodeUnknownResult(Schema.Array(CheckoutOrderCartView).check(Schema.isMaxLength(1)), { onExcessProperty: "error" });
const decodeShipping = Schema.decodeUnknownResult(Schema.Array(CheckoutShippingView).pipe(Schema.mutable), { onExcessProperty: "error" });
const malformed = () => new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native checkout graph selection" });
export function decodeCheckoutGraphRows(input: unknown, rows: readonly (typeof Schema.JsonObject.Type)[]) {
  if (isCart(input)) return decodeCart(rows).pipe(Result.mapError(malformed));
  if (isLink(input)) return decodeLink(rows).pipe(Result.mapError(malformed));
  if (isShipping(input)) return decodeShipping(rows).pipe(Result.mapError(malformed));
  return Result.succeed(rows);
}
