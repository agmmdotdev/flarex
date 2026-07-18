import type { H05DecodeFailure } from "./decodeFailure";

export function decodeNonEmptyH05String(
  value: unknown,
  path: string,
  fail: H05DecodeFailure,
): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}
