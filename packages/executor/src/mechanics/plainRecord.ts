import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";

/** Narrows executor boundary input to a record with a plain or null prototype. */
export function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!isNonArrayRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
