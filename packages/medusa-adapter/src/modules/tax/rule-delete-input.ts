import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import type { captureTaxMetadata } from "./schema";
import { TaxId } from "./query";
import { compileTaxCreationRows } from "./rate-create-input";

// Native retained selectors include duplicates and missing IDs, including the
// empty string. Stored identities still use the complete strict DML contract.
export const TaxRuleDeletionIds = Schema.Array(Schema.String.check(Schema.isMaxLength(256)))
  .pipe(Schema.mutable).check(Schema.isMaxLength(8));
export const TaxRuleDeletionOutput = Schema.Struct({
  tax_rate_rule_id: Schema.optionalKey(Schema.Array(TaxId).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 8),
    Schema.makeFilter(ids => new Set(ids).size === ids.length || "Expected distinct affected Rule IDs"))),
});
export const decodeTaxRuleDeletionIds = commerceDecoder(TaxRuleDeletionIds, "invalidInput");
export const decodeTaxRuleDeletionOutput = commerceDecoder(TaxRuleDeletionOutput, "storedCorruption");
const decodeLifecycleTuple = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)),
  Schema.Struct({ TaxRateRule: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8))) }),
]), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** The complete Tax DML remains installed; this profile selects only the Rule
 * lifecycle and validates native repository tuples before public projection. */
export function compileTaxRuleDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const { rule, tables, decodeRuleRow } = yield* compileTaxCreationRows(metadata);
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const [roots, cascades] = yield* decodeLifecycleTuple(input);
      if (!jsonEqual(roots, cascades.TaxRateRule ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      const rows = [], ids = new Set<string>(), parents = new Set<string>();
      for (const value of roots) {
        const row = yield* decodeRuleRow(value);
        if (ids.has(row.id) || typeof row.tax_rate_id !== "string") return yield* Result.fail(commerceError("storedCorruption"));
        ids.add(row.id); parents.add(row.tax_rate_id); rows.push(row);
      }
      if (parents.size > 4) return yield* Result.fail(commerceError("limitExceeded"));
      const output: Record<string, object[]> = {};
      if (cascades.TaxRateRule !== undefined) output.TaxRateRule = rows.map(row => ({ ...row }));
      return [rows.map(row => ({ ...row })), output] satisfies [object[], Record<string, unknown[]>];
    });
    return { rule, tables, decodeRuleRow, decodeLifecycleResult, decodeOutput: decodeTaxRuleDeletionOutput,
      Input: TaxRuleDeletionIds, Output: TaxRuleDeletionOutput };
  });
}
