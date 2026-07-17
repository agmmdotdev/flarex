import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";

export type H05RecordFailure = (path: string, message: string) => never;

/** Requires one shallow H05 record with exactly the expected enumerable keys. */
export function requireExactH05Record<const Keys extends readonly string[]>(
  value: unknown,
  path: string,
  keys: Keys,
  failAt: H05RecordFailure,
): UnknownRecord {
  if (!isNonArrayRecord(value)) failAt(path, "must be an object.");
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    failAt(path, `must contain exactly: ${expectedKeys.join(", ")}.`);
  }
  return value;
}
