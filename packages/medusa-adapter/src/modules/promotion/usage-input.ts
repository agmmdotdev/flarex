import { Result, Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";

const Action = Schema.Struct({ code: Schema.NullOr(Schema.String), amount: Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite())]) });
const Context = Schema.Struct({ customer_id: Schema.NullOr(Schema.String), customer_email: Schema.NullOr(Schema.String) });
// Checkout admits four LineItem adjustments and four ShippingMethod adjustments.
const Actions = Schema.Array(Action).pipe(Schema.mutable).check(Schema.isMaxLength(8));
export const PromotionUsageInput = Schema.Struct({ computedActions: Actions, registrationContext: Context })
  .check(Schema.makeFilter(value => new Set(value.computedActions.flatMap(action => action.code ? [action.code] : [])).size <= 4 || "Expected at most four Promotion codes"));
export const decodePromotionUsageInput = commerceDecoder(PromotionUsageInput, "invalidInput");
export const decodePromotionUsageArguments = commerceDecoder(Schema.Tuple([Actions, Context]), "invalidInput");
const nullOutput = commerceDecoder(Schema.Null, "storedCorruption");
export const decodePromotionUsageOutput = (input: unknown) => nullOutput(input).pipe(Result.map(() => undefined));
