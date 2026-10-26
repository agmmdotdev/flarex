import { Schema } from "effect";
import { PaymentCollectionStatus } from "@medusajs/framework/utils/portable";
import { commerceDecoder } from "../../value/decoder";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { PaymentAmount, PaymentCollectionCreate, PaymentId } from "./input";

export const CollectionIds = Schema.Array(PaymentId).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 1));
export const CollectionAmount = Schema.Union([PaymentAmount, Schema.Struct({ ...ExactNumericRaw.fields,
  value: Schema.String.check(Schema.isLengthBetween(1, 128)) })]);
export const CollectionCreates = Schema.Array(Schema.Struct({ ...PaymentCollectionCreate.fields, amount: CollectionAmount }))
  .pipe(Schema.mutable).check(Schema.isLengthBetween(1, 1));
export const CollectionPatch = Schema.Struct({ amount: Schema.optionalKey(CollectionAmount), currency_code: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)), status: Schema.optionalKey(Schema.Literals(Object.values(PaymentCollectionStatus))) });
export const CollectionUpdate = Schema.Struct({ selector: Schema.Struct({ id: PaymentId }), update: CollectionPatch });
export const CollectionUpserts = Schema.Array(Schema.Struct({ id: PaymentId, amount: Schema.optionalKey(CollectionAmount),
  currency_code: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)) })).pipe(Schema.mutable)
  .check(Schema.isLengthBetween(1, 1));
export const CollectionStoredPatch = Schema.Struct({ id: PaymentId, amount: Schema.optionalKey(Schema.String),
  raw_amount: Schema.optionalKey(ExactNumericRaw), currency_code: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)), status: CollectionPatch.fields.status });
export const CancelCollectionInput = Schema.Struct({ payment_collection_id: PaymentId });
export const CreateCartCollectionInput = Schema.Struct({ cart_id: PaymentId, metadata: Schema.optionalKey(Schema.JsonObject) });
export const RefreshCartCollectionInput = Schema.Struct({ cart_id: PaymentId });
export const CreateOrderCollectionInput = Schema.Struct({ order_id: PaymentId, amount: Schema.Finite });
export const decodeCollectionCreates = commerceDecoder(CollectionCreates, "invalidInput");
export const decodeCollectionUpdate = commerceDecoder(CollectionUpdate, "invalidInput");
export const decodeCollectionUpserts = commerceDecoder(CollectionUpserts, "invalidInput");
export const decodeCollectionIds = commerceDecoder(CollectionIds, "invalidInput");
export const decodeCollectionStoredPatch = commerceDecoder(CollectionStoredPatch, "unsupportedProfile");
export const decodeCollectionCreateArguments = commerceDecoder(Schema.Tuple([CollectionCreates]), "invalidInput");
export const decodeCollectionUpdateArguments = commerceDecoder(Schema.Tuple([CollectionUpdate.fields.selector, CollectionUpdate.fields.update]), "invalidInput");
export const decodeCollectionUpsertArguments = commerceDecoder(Schema.Tuple([CollectionUpserts]), "invalidInput");
export const decodeCollectionDeleteArguments = commerceDecoder(Schema.Tuple([CollectionIds]), "invalidInput");
