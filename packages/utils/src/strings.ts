/**
 * Compares strings in ECMAScript lexicographic UTF-16 code-unit order.
 *
 * This is the ordering used by the relational string operators. It is not
 * locale-aware and does not compare Unicode code points or grapheme clusters.
 */
export function compareUtf16Strings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
