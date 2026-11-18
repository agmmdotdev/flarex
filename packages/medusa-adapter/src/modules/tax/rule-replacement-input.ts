import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { TaxId } from "./query";
import { TaxRateRuleCreate } from "./rate-create-input";

// Selection retains raw duplicates and empty native no-match identities. The
// genuine root expands templates first, then each supplied Rate position.
export const TaxRuleReplacementRateIds = Schema.Array(Schema.String.check(Schema.isMaxLength(256)))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const TaxRuleReplacementInput = Schema.Struct({ tax_rate_ids: TaxRuleReplacementRateIds,
  rules: Schema.Array(Schema.Struct({ ...TaxRateRuleCreate.fields, metadata: Schema.optionalKey(Schema.Json) }))
    .pipe(Schema.mutable).check(Schema.isMaxLength(2)),
}).check(Schema.makeFilter(input => input.rules.length === 0 || input.tax_rate_ids.every(id => id.length > 0) ||
  "Empty Tax Rate identities are admitted only when no Rule templates are supplied"));
export const TaxRuleReplacementFilters = Schema.Struct({ tax_rate_id: TaxRuleReplacementRateIds });
export const TaxRuleReplacementConfig = Schema.Struct({ select: Schema.Tuple([Schema.Literal("id")]).pipe(Schema.mutable) });
export const TaxRuleReplacementRead = Schema.Struct({ filters: TaxRuleReplacementFilters, config: TaxRuleReplacementConfig });
export const TaxRuleReplacementIds = Schema.Array(Schema.Struct({ id: TaxId })).pipe(Schema.mutable).check(Schema.isMaxLength(8));
export const decodeTaxRuleReplacementInput = commerceDecoder(TaxRuleReplacementInput, "invalidInput");
export const decodeTaxRuleReplacementRead = commerceDecoder(TaxRuleReplacementRead, "invalidInput");
export const decodeTaxRuleReplacementIds = commerceDecoder(TaxRuleReplacementIds, "storedCorruption");
// buildQuery's own undefined fields are removed by the shared input capture.
export const decodeTaxRuleReplacementSelection = commerceDecoder(Schema.Struct({ where: TaxRuleReplacementFilters,
  options: Schema.Struct({ fields: Schema.Tuple([Schema.Literal("id")]),
    populate: Schema.optionalKey(Schema.Array(Schema.Never)),
    orderBy: Schema.Struct({ id: Schema.Literal("ASC") }),
  }),
}), "unsupportedProfile");
