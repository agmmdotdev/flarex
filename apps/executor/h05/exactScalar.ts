export type H05Scalar = string | number | boolean;

import type { H05DecodeFailure } from "./decodeFailure";

export function decodeExactH05Scalar<const Value extends H05Scalar>(
  value: unknown,
  expected: Value,
  path: string,
  fail: H05DecodeFailure,
): Value {
  if (value !== expected) {
    fail(`${path} must equal ${JSON.stringify(expected)}.`);
  }
  return expected;
}
