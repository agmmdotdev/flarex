import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";

/**
 * Returns whether a string names a canonical dense-array element below the
 * supplied array length.
 */
export function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return isNonNegativeSafeInteger(index) && index < length;
}
