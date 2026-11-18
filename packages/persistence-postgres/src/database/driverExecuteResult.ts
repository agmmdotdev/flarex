import { isNonArrayRecord } from "@flarex/utils/records";

/**
 * Extracts rows from the wrapper returned by installed Drizzle 0.45 raw
 * `execute` calls.
 *
 * This structural adapter neither validates nor detaches row members. The
 * caller owns invalid-result failure construction, and exceptions raised while
 * reading a wrapper's `rows` property pass through unchanged.
 */
export function rowsFromDriverExecuteResult(
  result: unknown,
  onInvalid: () => never,
): ReadonlyArray<unknown> {
  if (isNonArrayRecord(result)) {
    const rows = result.rows;
    if (Array.isArray(rows)) return rows;
  }
  return onInvalid();
}
