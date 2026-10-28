import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";

export const AddressIds = Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const Filter = Schema.Union([ScalarId, AddressIds]);
export const AddressFilter = Schema.Struct({ id: Schema.optionalKey(Filter), customer_id: Schema.optionalKey(Filter),
  is_default_billing: Schema.optionalKey(Schema.Boolean), is_default_shipping: Schema.optionalKey(Schema.Boolean) });
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
export const AddressPatch = Schema.Struct({ address_name: Text, company: Text, first_name: Text, last_name: Text,
  address_1: Text, address_2: Text, city: Text, country_code: Text, province: Text, postal_code: Text, phone: Text,
  is_default_billing: Schema.optionalKey(Schema.Boolean), is_default_shipping: Schema.optionalKey(Schema.Boolean),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)) });
export const AddressManaged = { created_at: Schema.optionalKey(Schema.String), updated_at: Schema.optionalKey(Schema.String), deleted_at: Schema.optionalKey(Schema.NullOr(Schema.String)) };
export const AddressCreate = Schema.Struct({ ...AddressPatch.fields, customer_id: ScalarId, id: Schema.optionalKey(ScalarId), ...AddressManaged });
export const AddressCreates = Schema.Array(AddressCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const AddressNativePatch = Schema.Struct({ ...AddressPatch.fields, id: Schema.optionalKey(ScalarId), customer_id: Schema.optionalKey(ScalarId), ...AddressManaged });
export const AddressUpdateOptions = Schema.Struct({ metadata: Schema.Literal("replace") });
export const AddressUpdate = Schema.Struct({ selector: Schema.Union([ScalarId, AddressFilter]), update: AddressNativePatch,
  options: Schema.optionalKey(AddressUpdateOptions) });
export const AddressRead = Schema.Struct({ filters: Schema.optionalKey(AddressFilter), config: Schema.optionalKey(Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable)),
  relations: Schema.optionalKey(Schema.Array(Schema.Never).pipe(Schema.mutable)),
  take: Schema.optionalKey(Schema.Literals([4, 15, 256])), skip: Schema.optionalKey(Schema.Literal(0)),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })),
})) });
export const AddressCreateRoot = Schema.Struct({ addresses: AddressCreates, additional_data: Schema.optionalKey(Schema.JsonObject) });
export const AddressUpdateRoot = Schema.Struct({ selector: AddressFilter, update: AddressPatch, additional_data: Schema.optionalKey(Schema.JsonObject) });
export const AddressDeleteRoot = Schema.Struct({ ids: AddressIds });
export const decodeAddressRead = commerceDecoder(AddressRead, "invalidInput");
export const decodeAddressUpdate = commerceDecoder(AddressUpdate, "invalidInput");
export const decodeAddressCreates = commerceDecoder(AddressCreates, "invalidInput");
export const decodeAddressIds = commerceDecoder(AddressIds, "invalidInput");
