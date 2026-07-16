import { describe, expect, expectTypeOf, it } from "vitest";

import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";

function readValue(value: unknown): unknown {
  if (!isNonArrayRecord(value)) return undefined;
  expectTypeOf(value).toEqualTypeOf<UnknownRecord>();
  return value.value;
}

describe("isNonArrayRecord", () => {
  it("accepts objects without claiming a plain-object contract", () => {
    const nullPrototype: unknown = Object.create(null);

    expect(isNonArrayRecord({ value: 1 })).toBe(true);
    expect(isNonArrayRecord(nullPrototype)).toBe(true);
    expect(isNonArrayRecord(new Date(0))).toBe(true);
    expect(isNonArrayRecord(new (class Example {})())).toBe(true);
    expect(readValue({ value: 1 })).toBe(1);
  });

  it("rejects null, arrays, functions, and primitive values", () => {
    expect(isNonArrayRecord(null)).toBe(false);
    expect(isNonArrayRecord([])).toBe(false);
    expect(isNonArrayRecord(() => undefined)).toBe(false);
    expect(isNonArrayRecord(undefined)).toBe(false);
    expect(isNonArrayRecord("value")).toBe(false);
    expect(isNonArrayRecord(1)).toBe(false);
    expect(isNonArrayRecord(true)).toBe(false);
  });
});
