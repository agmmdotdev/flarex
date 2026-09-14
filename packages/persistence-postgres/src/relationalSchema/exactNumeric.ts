import type { RelationalColumnDefault } from "./model";

/** Shared logical/physical policy over already-decoded columns. A nullable raw
 * column supports native generated metadata; adapters still owe paired writes. */
export function hasExactNumericCompanionDefaults(
  numeric: { readonly nullable: boolean; readonly default: RelationalColumnDefault },
  raw: { readonly nullable: boolean; readonly default: RelationalColumnDefault },
): boolean {
  if (numeric.nullable && !raw.nullable) return false;
  if (numeric.default.kind === "none") return raw.default.kind === "none";
  return numeric.default.kind === "exactNumericLiteral" &&
    raw.default.kind === "exactNumericRawLiteral" &&
    numeric.default.value === raw.default.value;
}
