import { isNonEmptyString } from "@flarex/utils/strings";
import type { H05DecodeFailure } from "./decodeFailure";

export function decodeNonEmptyH05String(
  value: unknown,
  path: string,
  fail: H05DecodeFailure,
): string {
  if (!isNonEmptyString(value)) {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}
