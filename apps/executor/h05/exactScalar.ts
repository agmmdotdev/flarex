export type H05Scalar = string | number | boolean;

export type H05ExactScalarFailure = (message: string) => never;

export function decodeExactH05Scalar<const Value extends H05Scalar>(
  value: unknown,
  expected: Value,
  path: string,
  fail: H05ExactScalarFailure,
): Value {
  if (value !== expected) {
    fail(`${path} must equal ${JSON.stringify(expected)}.`);
  }
  return expected;
}
