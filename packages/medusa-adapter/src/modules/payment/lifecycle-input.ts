import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { PaymentAmount, PaymentId, PaymentRead } from "./input";

export const PaymentAuthorization = Schema.Struct({ id: PaymentId, context: Schema.optionalKey(Schema.JsonObject) });
export const PaymentCapture = Schema.Struct({ payment_id: PaymentId, amount: Schema.optionalKey(PaymentAmount),
  captured_by: Schema.optionalKey(PaymentId) });
export const PaymentRefund = Schema.Struct({ payment_id: PaymentId, amount: Schema.optionalKey(PaymentAmount),
  created_by: Schema.optionalKey(PaymentId), note: Schema.optionalKey(Schema.String), refund_reason_id: Schema.optionalKey(PaymentId) });
export const decodePaymentAuthorization = commerceDecoder(PaymentAuthorization, "invalidInput");
export const decodePaymentCapture = commerceDecoder(PaymentCapture, "invalidInput");
export const decodePaymentRefund = commerceDecoder(PaymentRefund, "invalidInput");
export const decodePaymentAuthorizationArguments = commerceDecoder(Schema.Tuple([PaymentId, Schema.JsonObject]), "invalidInput");
export const decodePaymentCaptureArguments = commerceDecoder(Schema.Tuple([PaymentCapture]), "invalidInput");
export const decodePaymentRefundArguments = commerceDecoder(Schema.Tuple([PaymentRefund]), "invalidInput");
export const PaymentRetrieve = Schema.Struct({ id: PaymentId, config: Schema.optionalKey(PaymentRead.fields.config.schema) });
export const decodePaymentRetrieve = commerceDecoder(PaymentRetrieve, "invalidInput");
export const decodePaymentRetrieveArguments = commerceDecoder(Schema.Union([Schema.Tuple([PaymentId]),
  Schema.Tuple([PaymentId, Schema.UndefinedOr(PaymentRead.fields.config.schema)])]), "invalidInput");

const exactAmount = { amount: Schema.String, raw_amount: ExactNumericRaw };
export const decodeNativePaymentCreate = commerceDecoder(Schema.Struct({ ...exactAmount, currency_code: Schema.String,
  provider_id: Schema.Literal("pp_system_default"), data: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  payment_session: PaymentId, payment_collection_id: PaymentId }), "unsupportedProfile");
export const decodeNativeCaptureCreate = commerceDecoder(Schema.Struct({ ...exactAmount, payment: PaymentId,
  captured_by: Schema.optionalKey(PaymentId) }), "unsupportedProfile");
export const decodeNativeRefundCreate = commerceDecoder(Schema.Struct({ ...exactAmount, payment: PaymentId,
  created_by: Schema.optionalKey(PaymentId), note: Schema.optionalKey(Schema.NullOr(Schema.String)),
  refund_reason_id: Schema.optionalKey(Schema.NullOr(PaymentId)) }), "unsupportedProfile");
export const decodeNativeSessionPatch = commerceDecoder(Schema.Struct({ id: PaymentId,
  data: Schema.optionalKey(Schema.JsonObject), status: Schema.Literals(["pending", "authorized", "captured", "requires_more", "error", "canceled"]),
  authorized_at: Schema.optionalKey(Schema.String) }), "unsupportedProfile");
export const decodeNativePaymentPatch = commerceDecoder(Schema.Struct({ id: PaymentId, data: Schema.optionalKey(Schema.JsonObject),
  captured_at: Schema.optionalKey(Schema.String), canceled_at: Schema.optionalKey(Schema.String) }), "unsupportedProfile");
export const decodeNativeCollectionPatch = commerceDecoder(Schema.Struct({ id: PaymentId, status: Schema.String,
  authorized_amount: Schema.String, raw_authorized_amount: ExactNumericRaw,
  captured_amount: Schema.String, raw_captured_amount: ExactNumericRaw,
  refunded_amount: Schema.String, raw_refunded_amount: ExactNumericRaw, completed_at: Schema.optionalKey(Schema.String) }), "unsupportedProfile");
