import { Schema } from "effect";
import { ShippingOptionId } from "../../modules/fulfillment/shipping-option-create-input";

export const PriceRule = Schema.Struct({ attribute: ShippingOptionId, operator: Schema.String,
  value: Schema.Number.check(Schema.isFinite()) });
const PriceFields = { amount: Schema.Number.check(Schema.isFinite()),
  rules: Schema.optionalKey(Schema.Array(PriceRule).check(Schema.isMaxLength(2))) };
export const ShippingOptionWorkflowPrice = Schema.Union([
  Schema.Struct({ currency_code: ShippingOptionId, ...PriceFields }),
  Schema.Struct({ region_id: ShippingOptionId, ...PriceFields }),
]);
