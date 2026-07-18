import type { H05DecodeFailure } from "./decodeFailure";

/**
 * Checks the ordering of timestamps that their owning H05 decoder has already
 * validated. This deliberately does not add a second timestamp validator.
 */
export function requireOrderedH05Timestamps(
  earlier: string,
  later: string,
  path: string,
  fail: H05DecodeFailure,
): void {
  if (Date.parse(earlier) > Date.parse(later)) {
    fail(`${path} timestamps are out of order.`);
  }
}
