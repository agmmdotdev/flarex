import { Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeGraphCount } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { VariantItemPricingCalculationOutput } from "./calculation";

/** The full native calculation DTO is validated before any graph field mask. */
const decodeCalculated = commerceDecoder(VariantItemPricingCalculationOutput, "storedCorruption");
export function decodeStorePriceSetCount(value: unknown, requireCalculated = false) {
  return decodeGraphCount(value).pipe(Result.flatMap(([rows, count]) => Result.gen(function* () {
    for (const row of rows) {
      const calculated = row.calculated_price;
      if (requireCalculated && calculated === undefined) return yield* Result.fail(commerceError("storedCorruption"));
      if (calculated === undefined || calculated === null) continue;
      const [dto] = yield* decodeCalculated([calculated]);
      if (dto === undefined || dto.id !== row.id) return yield* Result.fail(commerceError("storedCorruption"));
    }
    return [rows, count] as const;
  })));
}

/** Projection grammar only. Amount companions remain selectable native fields;
 * no calculated identity participates in stored keys, order or link evidence. */
export const storeCalculatedPriceObject = { fields: [
  "id", "is_calculated_price_price_list", "is_calculated_price_tax_inclusive", "calculated_amount",
  "raw_calculated_amount.value", "raw_calculated_amount.precision", "is_original_price_price_list",
  "is_original_price_tax_inclusive", "original_amount", "raw_original_amount.value", "raw_original_amount.precision", "currency_code",
  ...["calculated_price", "original_price"].flatMap(prefix => ["id", "price_list_id", "price_list_type", "min_quantity", "max_quantity"].map(field => prefix + "." + field)),
] };
