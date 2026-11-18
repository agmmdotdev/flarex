import { Schema } from "effect";
import type { Link } from "@medusajs/modules-sdk/link";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Arguments = Schema.Tuple([Schema.Struct({ variant_id: Schema.Array(Id).check(Schema.isMaxLength(4)) }),
  Schema.Struct({ select: Schema.Array(Schema.Literals(["variant_id", "price_set_id"])).check(Schema.isLengthBetween(2, 2)) })]);
export const decodeVariantPricingListArguments = commerceDecoder(Arguments, "invalidInput");

/** Native service selection stays within the borrowed router; only checked
 * JSON rows cross the asynchronous workflow resource boundary. */
export async function listNativeVariantPricing(native: Link, ...[filters, config]: typeof Arguments.Type) {
  const service = native.getLinkModule(Modules.PRODUCT, "variant_id", Modules.PRICING, "price_set_id");
  if (!service) throw commerceError("unsupportedProfile");
  return service.list({ variant_id: [...filters.variant_id] }, { select: [...config.select] });
}
