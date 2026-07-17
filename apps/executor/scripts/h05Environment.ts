/**
 * Requires a non-blank environment value and returns its trimmed spelling.
 *
 * Use this for identifiers and configuration values whose surrounding
 * whitespace is not meaningful.
 */
export function requiredEnvironmentValue(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim();
  if (normalized !== undefined && normalized.length > 0) return normalized;
  throw new Error(`${name} is required.`);
}

/**
 * Requires a non-empty environment value without changing its spelling.
 *
 * Use this for secrets because trimming would silently alter credentials.
 */
export function requiredUntrimmedEnvironmentValue(
  value: string | undefined,
  name: string,
): string {
  if (value !== undefined && value.length > 0) return value;
  throw new Error(`${name} is required.`);
}
