/**
 * Returns whether a string is exactly the canonical spelling emitted by
 * `Date.prototype.toISOString()` for the parsed instant.
 *
 * This accepts the full ECMAScript ISO output grammar, including extended
 * years. It does not brand the value or establish freshness, ordering,
 * authority, or a domain-specific year range.
 */
export function isCanonicalIsoTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}
