import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { isJson, JsonValue, type Json, type WritableJson } from "../src/json";

const decodeJson = Schema.decodeUnknownSync(JsonValue);

describe("protocol JSON", () => {
  it("provides a writable compatibility shape without changing canonical JSON", () => {
    const writable = { nested: [1] } satisfies WritableJson;

    writable.nested.push(2);

    expect(writable).toEqual({ nested: [1, 2] });
    expectTypeOf(writable).toMatchTypeOf<WritableJson>();
    expectTypeOf<WritableJson>().toMatchTypeOf<Json>();
  });

  it("accepts finite plain JSON values", () => {
    const nullPrototypeObject: Record<string, unknown> = {
      nested: [null, true, 1, "value"],
    };
    Object.setPrototypeOf(nullPrototypeObject, null);

    expect(isJson(nullPrototypeObject)).toBe(true);
    expect(decodeJson(nullPrototypeObject)).toEqual(nullPrototypeObject);
  });

  it("rejects values outside the shared JSON contract", () => {
    const symbolProperty = { value: true, [Symbol("hidden")]: false };

    expect(isJson(Number.NaN)).toBe(false);
    expect(isJson(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJson(undefined)).toBe(false);
    expect(isJson(new Date(0))).toBe(false);
    expect(isJson(symbolProperty)).toBe(false);
    expect(() => decodeJson(symbolProperty)).toThrow();
  });
});
