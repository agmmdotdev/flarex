import { Schema } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { ScalarId } from "../../repository/scalar-id-read";
import { RootAddress, RootLine } from "./creation-input";
import { CartItemTaxLine, CartShippingTaxLine } from "./refresh-input";

const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const Amount = Schema.Union([Schema.String, Schema.Finite, Schema.Struct(ExactNumericRaw.fields)]);
const Metadata = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
export const CartMutationIds = Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
/** Lifecycle descendants retain complete native history, independently of the
 * four-root authoring shape. Existing shared resource owners remain ceilings. */
export const cartLineHistoryMaximum = Math.min(defaultCommerceResources.queryRows,
  defaultCommerceResources.writeBatchRows, defaultCommerceResources.eventIds);
export const CartLineHistoryIds = Schema.Array(ScalarId).check(Schema.isLengthBetween(1, cartLineHistoryMaximum));
const Selection = Schema.Union([ScalarId, CartMutationIds]);
export const CartMutationAddress = Schema.Struct({ ...RootAddress.fields, id: Schema.optionalKey(ScalarId) });
export const CartMutationPatch = Schema.Struct({ id: ScalarId, region_id: Text, customer_id: Text, sales_channel_id: Text,
  currency_code: Text, email: Text, locale: Text, metadata: Metadata, completed_at: Text,
  shipping_address_id: Text, billing_address_id: Text,
  shipping_address: Schema.optionalKey(Schema.NullOr(Schema.Union([CartMutationAddress, ScalarId]))),
  billing_address: Schema.optionalKey(Schema.NullOr(Schema.Union([CartMutationAddress, ScalarId]))) });
export const CartMutationUpdates = Schema.Array(CartMutationPatch).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartMutationAddressPatch = Schema.Struct({ ...CartMutationAddress.fields, id: ScalarId });
export const CartMutationAddressUpdates = Schema.Array(CartMutationAddressPatch).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartMutationLinePatch = Schema.Struct({ ...RootLine.fields, id: Schema.optionalKey(ScalarId),
  cart_id: Schema.optionalKey(ScalarId), title: Schema.optionalKey(Schema.String), quantity: Schema.optionalKey(Amount),
  unit_price: Schema.optionalKey(Amount), compare_at_unit_price: Schema.optionalKey(Schema.NullOr(Amount)) });
export const CartMutationLineFilters = Schema.Struct({ id: Schema.optionalKey(Selection), cart_id: Schema.optionalKey(ScalarId),
  variant_id: Schema.optionalKey(Selection), is_custom_price: Schema.optionalKey(Schema.Boolean) });
export const CartMutationLineEntries = Schema.Array(Schema.Union([
  Schema.Struct({ ...CartMutationLinePatch.fields, id: ScalarId }),
  Schema.Struct({ selector: CartMutationLineFilters, data: CartMutationLinePatch }),
])).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartMutationLineUpdate = Schema.Struct({ target: Schema.Union([ScalarId, CartMutationLineFilters, CartMutationLineEntries]),
  data: Schema.optionalKey(CartMutationLinePatch) });
export const CartMutationLineCreates = Schema.Array(Schema.Struct({ ...RootLine.fields, cart_id: ScalarId,
  quantity: Amount, compare_at_unit_price: Schema.optionalKey(Schema.NullOr(Amount)) })).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const CartMutationRead = Schema.Struct({ filters: CartMutationLineFilters,
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
    relations: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
    take: Schema.optionalKey(Schema.Literals([4, 15, 256])), skip: Schema.optionalKey(Schema.Literal(0)),
    order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) })) });
export const decodeCartMutationUpdates = commerceDecoder(CartMutationUpdates, "invalidInput");
export const decodeCartMutationAddressUpdates = commerceDecoder(CartMutationAddressUpdates, "invalidInput");
export const decodeCartMutationLineUpdate = commerceDecoder(CartMutationLineUpdate, "invalidInput");
export const decodeCartMutationLineCreates = commerceDecoder(CartMutationLineCreates, "invalidInput");
export const decodeCartMutationRead = commerceDecoder(CartMutationRead, "invalidInput");
export const decodeCartMutationIds = commerceDecoder(CartMutationIds, "invalidInput");
export const CartMutationTaxLines = Schema.Array(Schema.Struct({ ...CartItemTaxLine.fields, id: Schema.optionalKey(ScalarId) }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeCartMutationTaxLines = commerceDecoder(CartMutationTaxLines, "invalidInput");
export const CartMutationShippingTaxLines = Schema.Array(Schema.Struct({ ...CartShippingTaxLine.fields, id: Schema.optionalKey(ScalarId) }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeCartMutationShippingTaxLines = commerceDecoder(CartMutationShippingTaxLines, "invalidInput");
