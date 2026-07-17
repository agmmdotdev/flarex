/**
 * Returns whether an unknown value is a non-negative JavaScript safe integer.
 * JavaScript negative zero is accepted because it compares as non-negative.
 */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Returns whether an unknown value is a positive JavaScript safe integer. */
export function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
}
