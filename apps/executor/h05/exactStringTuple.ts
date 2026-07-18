import type { H05DecodeFailure } from "./decodeFailure";

export function decodeExactH05StringTuple<
  const Expected extends readonly string[],
>(
  value: unknown,
  expected: Expected,
  path: string,
  fail: H05DecodeFailure,
): Expected {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((item, index) => item !== expected[index])
  ) {
    fail(`${path} must equal ${JSON.stringify(expected)}.`);
  }
  return expected;
}
