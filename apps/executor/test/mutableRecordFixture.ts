import { isNonArrayRecord } from "@flarex/utils/records";

export function mutableFixtureRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!isNonArrayRecord(value)) throw new Error(message);
  return { ...value };
}

export function cloneFixtureRecord(value: unknown): Record<string, unknown> {
  return mutableFixtureRecord(
    structuredClone(value),
    "fixture clone must be an object",
  );
}

export function mutableNestedFixtureRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const nested = mutableFixtureRecord(
    record[key],
    `fixture ${key} must be an object`,
  );
  record[key] = nested;
  return nested;
}

export function mutableNestedFixtureRecordArray(
  record: Record<string, unknown>,
  objectKey: string,
  arrayKey: string,
): Record<string, unknown>[] {
  const owner = mutableNestedFixtureRecord(record, objectKey);
  const value = owner[arrayKey];
  if (!Array.isArray(value) || !value.every(isNonArrayRecord)) {
    throw new Error(`fixture ${arrayKey} must be an object array`);
  }
  const records = value.map(item => ({ ...item }));
  owner[arrayKey] = records;
  return records;
}
