import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";

export const PaymentId = Schema.String.check(Schema.isLengthBetween(1, 256));
export const PaymentAmount = Schema.Union([Schema.String.check(Schema.isLengthBetween(1, 128)), Schema.Number.check(Schema.isFinite())]);
export const PaymentSessionData = Schema.Struct({ provider_id: Schema.Literal("pp_system_default"), currency_code: Schema.String,
  amount: PaymentAmount, data: Schema.JsonObject, context: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  metadata: Schema.optionalKey(Schema.JsonObject) });
export const PaymentSessionCreate = Schema.Struct({ payment_collection_id: PaymentId, ...PaymentSessionData.fields });
export const PaymentCollectionCreate = Schema.Struct({ currency_code: Schema.String, amount: PaymentAmount,
  metadata: Schema.optionalKey(Schema.JsonObject) });
export const PaymentSessionIds = Schema.Array(PaymentId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const PaymentSessionRootInput = Schema.Struct({ payment_collection_id: PaymentId,
  provider_id: Schema.Literal("pp_system_default"), data: Schema.optionalKey(Schema.JsonObject), context: Schema.optionalKey(Schema.JsonObject) });
export const PaymentDeleteRootInput = Schema.Struct({ ids: PaymentSessionIds });
export const PaymentRead = Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  id: Schema.optionalKey(Schema.Union([PaymentId, PaymentSessionIds])) })),
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
    relations: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)), take: Schema.optionalKey(Schema.Literals([15, 256])),
    skip: Schema.optionalKey(Schema.Literal(0)), order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) })) });
export const decodePaymentCreate = commerceDecoder(PaymentSessionCreate, "invalidInput");
export const decodePaymentCollectionCreate = commerceDecoder(PaymentCollectionCreate, "invalidInput");
export const decodePaymentDelete = commerceDecoder(PaymentId, "invalidInput");
export const decodePaymentRead = commerceDecoder(PaymentRead, "invalidInput");
export const decodePaymentCreateArguments = commerceDecoder(Schema.Tuple([PaymentId, PaymentSessionData]), "invalidInput");
export const decodePaymentDeleteArguments = commerceDecoder(Schema.Tuple([PaymentId]), "invalidInput");
export const decodePaymentReadArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([Schema.UndefinedOr(PaymentRead.fields.filters.schema)]),
  Schema.Tuple([Schema.UndefinedOr(PaymentRead.fields.filters.schema), Schema.UndefinedOr(PaymentRead.fields.config.schema)]),
]), "invalidInput");
