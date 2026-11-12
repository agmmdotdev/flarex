import { Result, Schema } from "effect";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";

const Rest = [Schema.Record(Schema.String, Schema.Json)] as const;
export const NativeCartShippingMethodView = Schema.StructWithRest(Schema.Struct({ id: Schema.String,
  shipping_option_id: Schema.NullOr(Schema.String), data: Schema.NullOr(Schema.JsonObject),
}), Rest);
const Price = Schema.StructWithRest(Schema.Struct({ calculated_amount: Schema.Finite,
  is_calculated_price_tax_inclusive: Schema.Boolean,
}), Rest);
const CalculatedPrice = Schema.StructWithRest(Schema.Struct({ calculated_amount: Schema.NullOr(Schema.Finite),
  is_calculated_price_tax_inclusive: Schema.Boolean,
}), Rest);
const optionFields = { id: Schema.String,
  name: Schema.String, price_type: Schema.String, provider_id: Schema.String, data: Schema.NullOr(Schema.JsonObject),
  service_zone: Schema.StructWithRest(Schema.Struct({ fulfillment_set_id: Schema.String,
    fulfillment_set: Schema.StructWithRest(Schema.Struct({ type: Schema.String,
      location: Schema.StructWithRest(Schema.Struct({ id: Schema.String, address: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)) }), Rest),
    }), Rest),
  }), Rest),
  calculated_price: Schema.optionalKey(Schema.NullOr(CalculatedPrice)),
};
export const NativeShippingOptionView = Schema.StructWithRest(Schema.Struct(optionFields), Rest);
export type NativeShippingOptionView = typeof NativeShippingOptionView.Type;
// The native unpriced transform owns amount: undefined for an unquoted option.
// Index signatures also check declared fields, so admit that single native
// intermediate presence while requiring JSON values for every other member.
export const NativePricedShippingOptionView = Schema.StructWithRest(Schema.Struct({ ...optionFields,
  amount: Schema.optionalKey(Schema.NullOr(Schema.UndefinedOr(Schema.Finite))), is_tax_inclusive: Schema.optionalKey(Schema.Boolean),
  stock_location: Schema.optionalKey(Schema.JsonObject),
}), [Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Json))]).check(Schema.makeFilter(value =>
  Object.keys(value).every(key => key === "amount" || value[key] !== undefined)));
const decodeOptions = Schema.decodeUnknownResult(Schema.Array(NativeShippingOptionView).pipe(Schema.mutable));
const decodePrices = Schema.decodeUnknownResult(Schema.Array(Price).pipe(Schema.mutable));
const decodePriced = Schema.decodeUnknownResult(Schema.Array(NativePricedShippingOptionView).pipe(Schema.mutable));
const malformed = (cause?: unknown) => {
  const error = new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Malformed native Shipping calculation projection" });
  error.cause = cause;
  return error;
};
export const decodeNativeShippingOptions = (value: unknown) => Result.getOrThrow(decodeOptions(value).pipe(Result.mapError(malformed)));
export const decodeNativeShippingPrices = (value: unknown) => Result.getOrThrow(decodePrices(value).pipe(Result.mapError(malformed)));
export const decodeNativePricedShippingOptions = (value: unknown) => Result.getOrThrow(decodePriced(value).pipe(Result.mapError(malformed)));

/** Nullable DML keys/data remain native values. Their currently unsupported
 * provider/query branch still needs actual resource and query admission. */
export interface NativeCartShippingOptionsInput {
  readonly cart_id: string;
  readonly options?: readonly { readonly id: string | null; readonly data?: typeof Schema.JsonObject.Type | null | undefined }[] | undefined;
  readonly is_return?: boolean | undefined;
  readonly enabled_in_store?: boolean | undefined;
}
/** The consumed foreign-call shape makes no complete DTO or RMA claim. */
export interface NativeShippingOptionPriceInput {
  readonly id: string;
  readonly provider_id: string;
  readonly optionData: typeof Schema.JsonObject.Type | null;
  readonly data: typeof Schema.JsonObject.Type | null | undefined;
  readonly context: Readonly<Record<string, unknown>>;
}
