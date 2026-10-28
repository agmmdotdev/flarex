import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { PaymentId, PaymentSessionRootInput } from "./input";

const Customer = Schema.StructWithRest(Schema.Struct({ id: PaymentId, email: Schema.optionalKey(Schema.NullOr(Schema.String)) }), [Schema.Record(Schema.String, Schema.Json)]);
export const AccountHolderCreate = Schema.Struct({ provider_id: Schema.Literal("pp_system_default"), context: Schema.Struct({
  customer: Customer, account_holder: Schema.optionalKey(Schema.JsonObject),
}) });
export const AccountHolderStoredCreate = Schema.Struct({ provider_id: Schema.Literal("pp_system_default"), external_id: PaymentId,
  email: Schema.optionalKey(Schema.NullOr(Schema.String)), data: Schema.optionalKey(Schema.JsonObject) });
export const CustomerPaymentSessionInput = Schema.Struct({ ...PaymentSessionRootInput.fields, customer_id: PaymentId });
export const decodeAccountHolderCreate = commerceDecoder(AccountHolderCreate, "invalidInput");
export const decodeAccountHolderArguments = commerceDecoder(Schema.Tuple([AccountHolderCreate]), "invalidInput");
