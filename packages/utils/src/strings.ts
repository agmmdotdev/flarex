const LOWERCASE_UUID_TEXT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Compares strings in ECMAScript lexicographic UTF-16 code-unit order.
 *
 * This is the ordering used by the relational string operators. It is not
 * locale-aware and does not compare Unicode code points or grapheme clusters.
 */
export function compareUtf16Strings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Returns whether a value is a primitive string containing at least one code
 * unit after ECMAScript whitespace is trimmed from both ends.
 *
 * This predicate does not normalize or return the trimmed spelling. It does
 * not reject null bytes, zero-width characters, or domain-specific text.
 */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns whether a string has the lowercase hexadecimal 8-4-4-4-12 UUID text
 * shape.
 *
 * This predicate checks spelling only. It does not enforce UUID version or
 * variant bits, attach a domain brand, or establish identifier authority.
 */
export function isLowercaseUuidText(value: string): boolean {
  return LOWERCASE_UUID_TEXT_PATTERN.test(value);
}

/**
 * Returns an ECMAScript-trimmed nonblank string, or null when an optional
 * string is missing or trims to empty.
 *
 * This helper intentionally merges undefined and blank input into the same
 * null sentinel. It does not apply domain-specific text validation.
 */
export function trimToNonBlankOrNull(
  value: string | undefined,
): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
