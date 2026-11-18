import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";

export const CustomerSelectionId = Schema.String.check(Schema.isLengthBetween(1, 256));
export const CustomerSelectionFilters = Schema.Struct({ email: Schema.String,
  has_account: Schema.optionalKey(Schema.Literal(false)) });
export const CustomerSelectionCreate = Schema.Struct({ email: Schema.String });
export const decodeCustomerRetrieve = commerceDecoder(Schema.Struct({ id: CustomerSelectionId }), "invalidInput");
export const decodeCustomerList = commerceDecoder(CustomerSelectionFilters, "invalidInput");
export const decodeCustomerCreate = commerceDecoder(CustomerSelectionCreate, "invalidInput");
export const decodeCustomerDelete = commerceDecoder(CustomerSelectionId, "invalidInput");
export const decodeCustomerRetrieveArguments = commerceDecoder(Schema.Tuple([CustomerSelectionId]), "invalidInput");
export const decodeCustomerListArguments = commerceDecoder(Schema.Tuple([CustomerSelectionFilters]), "invalidInput");
export const decodeCustomerCreateArguments = commerceDecoder(Schema.Tuple([CustomerSelectionCreate]), "invalidInput");
export const decodeCustomerDeleteArguments = commerceDecoder(Schema.Tuple([CustomerSelectionId]), "invalidInput");
export const decodeCustomerPhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: CustomerSelectionId })).check(Schema.isLengthBetween(1, 1)),
}), "unsupportedProfile");

// Native internal services build precisely these full scalar reads. The public
// workflow surface supplies no configuration or arbitrary selectors.
export const CustomerSelectionWhere = Schema.Union([
  Schema.Struct({ id: CustomerSelectionId }), CustomerSelectionFilters,
]);
export const decodeCustomerSelectionQuery = commerceDecoder(Schema.Struct({ where: CustomerSelectionWhere,
  options: Schema.Struct({ populate: Schema.Array(Schema.Never),
    orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }),
}), "unsupportedProfile");
