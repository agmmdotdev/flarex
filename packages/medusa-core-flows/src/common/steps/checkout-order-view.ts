import { Schema } from "effect";

const NativeFields = Schema.Record(Schema.String, Schema.Unknown);
const PreparedAdjustment = Schema.StructWithRest(Schema.Struct({
  code: Schema.UndefinedOr(Schema.NullOr(Schema.String)),
}), [NativeFields]);
const PreparedAdjustments = Schema.Array(PreparedAdjustment).pipe(Schema.mutable);
const PreparedAmount = Schema.Union([Schema.Finite, Schema.String,
  Schema.Struct({ value: Schema.String, precision: Schema.Finite })]);
const PreparedLineItem = Schema.StructWithRest(Schema.Struct({ title: Schema.String,
  quantity: Schema.Finite, unit_price: PreparedAmount, adjustments: PreparedAdjustments,
}), [NativeFields]);

// The pinned preparation helper returns any and creates own undefined fields.
// Check fields consumed by this composition; retain the other native inputs for
// the existing Order creation owner to admit, without claiming its entire DTO.
export const decodeCheckoutPreparedLineItem = Schema.decodeUnknownSync(PreparedLineItem);
export const decodeCheckoutPreparedAdjustments = Schema.decodeUnknownSync(PreparedAdjustments);

/** Native createOrders' default selection, consumed by the checkout root.
 * Retain all genuine returned JSON fields; do not assert a complete Order DTO. */
export const CheckoutCreatedOrders = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String,
  items: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String, quantity: Schema.Finite,
    variant_id: Schema.NullOr(Schema.String) }), [Schema.Record(Schema.String, Schema.Json)])).pipe(Schema.mutable),
}), [Schema.Record(Schema.String, Schema.Json)])).pipe(Schema.mutable);
export const decodeCheckoutCreatedOrders = Schema.decodeUnknownSync(CheckoutCreatedOrders);
