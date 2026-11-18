import { Result, Schema, type Effect } from "effect";
import { commerceDecoder } from "../../value/decoder";
import type { captureTaxMetadata } from "./schema";
import { TaxId } from "./query";
import { compileTaxCreationRows, TaxRateRuleCreate } from "./rate-create-input";

export const TaxRuleCreate = Schema.Struct({ ...TaxRateRuleCreate.fields, tax_rate_id: TaxId,
  metadata: Schema.optionalKey(Schema.Json) });
export const TaxRuleCreatesInput = Schema.Array(TaxRuleCreate).pipe(Schema.mutable).check(Schema.isMaxLength(8),
  Schema.makeFilter(rows => new Set(rows.map(row => row.tax_rate_id)).size <= 4 || "Expected at most four Tax Rates"));
const TaxRuleOutput = Schema.Struct({ id: TaxId, tax_rate_id: TaxId, reference: Schema.String, reference_id: Schema.String,
  metadata: Schema.Json, created_by: Schema.NullOr(Schema.String),
  created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });
export const TaxRuleCreatesOutput = Schema.Array(TaxRuleOutput).pipe(Schema.mutable).check(Schema.isMaxLength(8));
export const TaxRulePhysicalDeletionIds = Schema.Array(TaxId).pipe(Schema.mutable).check(Schema.isMaxLength(8));
export const decodeTaxRuleCreates = commerceDecoder(TaxRuleCreatesInput, "invalidInput");
export const decodeTaxRulePhysicalDeletionIds = commerceDecoder(TaxRulePhysicalDeletionIds, "invalidInput");
export const decodeTaxRulePhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: TaxId })).check(Schema.isMaxLength(8)),
}), "unsupportedProfile");
const decodeStoredTaxRuleOutputs = commerceDecoder(TaxRuleCreatesOutput, "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** Standalone Rules preserve their own creator and scalar defaults. The full
 * native Tax DML remains checked, while only Rule rows enter this profile. */
export function compileTaxRuleCreationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const { rule, tables, ruleDefaults, decodeRuleRow } = yield* compileTaxCreationRows(metadata);
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeStoredTaxRuleOutputs(input);
      for (const row of rows) {
        yield* decodeRuleRow(row);
      }
      return rows;
    });
    return { rule, tables, ruleDefaults, decodeRuleRow,
      entities: [{ table: rule, model: "TaxRateRule", maximum: 8, decodeRow: decodeRuleRow }],
      Input: TaxRuleCreatesInput, Output: TaxRuleCreatesOutput, decodeInput: decodeTaxRuleCreates, decodeOutput };
  });
}
