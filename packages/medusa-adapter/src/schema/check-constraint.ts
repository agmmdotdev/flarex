import { Schema } from "effect";

/** The two-valued null implications emitted by the selected native DML.
 * Preserve their source spelling; this is not an arbitrary SQL parser. */
const NullImplicationExpression = Schema.String.check(Schema.isPattern(
  /^[A-Za-z_][A-Za-z0-9_]{0,255} IS NULL OR [A-Za-z_][A-Za-z0-9_]{0,255} IS (?:NOT )?NULL(?![\s\S])/,
));

export const CompiledCheckConstraint = Schema.Struct({
  name: Schema.String,
  expression: Schema.Union([NullImplicationExpression, Schema.String.check(Schema.isPattern(
    /^"[A-Za-z_][A-Za-z0-9_]{0,255}" >= 0(?![\s\S])/,
  ))]),
});

export function lowerCompiledCheckConstraint(check: typeof CompiledCheckConstraint.Type) {
  if (check.expression.endsWith(" >= 0")) return {
    constraintId: check.name, kind: "numericLowerBound" as const,
    columnId: check.expression.slice(1, -6), minimum: "0",
  };
  const separator = " IS NULL OR ";
  const split = check.expression.indexOf(separator);
  const required = check.expression.slice(split + separator.length);
  return {
    constraintId: check.name,
    kind: "nullImplication" as const,
    nonNullColumnId: check.expression.slice(0, split),
    requiredColumnId: required.slice(0, required.indexOf(" IS ")),
    required: required.endsWith(" IS NOT NULL") ? "notNull" as const : "null" as const,
  };
}
