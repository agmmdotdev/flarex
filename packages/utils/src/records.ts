export type UnknownRecord = Readonly<Record<string, unknown>>;

/**
 * Narrows a non-null, non-array object to a readonly string-keyed record.
 *
 * This does not require a plain prototype and does not reject symbol keys.
 */
export function isNonArrayRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
