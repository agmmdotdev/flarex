import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  encodeCanonicalJson,
  isJson,
  isJsonArray,
  isJsonObject,
  isJsonObjectFromUnknown,
  isWritableJsonObject,
  isWritableJsonObjectFromUnknown,
  isWritableJsonFromUnknown,
  jsonEqual,
  Json as JsonSchema,
  JsonValue,
  measureCanonicalJsonUtf8Bytes,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
  type JsonObject,
  type WritableJson,
  type WritableJsonObject,
} from "../src/json";

const decodeJson = Schema.decodeUnknownSync(JsonValue);
const decodeJsonSchema = Schema.decodeUnknownSync(JsonSchema);

function failCanonicalJsonEncoding(
  issue: CanonicalJsonEncodingInvariantIssue,
): never {
  throw new Error(issue.reason);
}

function expectJsonObjectNarrowing(value: Json): void {
  if (isJsonObject(value)) {
    expectTypeOf(value).toEqualTypeOf<JsonObject>();
  }
}

function expectJsonArrayNarrowing(value: Json): void {
  if (isJsonArray(value)) {
    expectTypeOf(value).toEqualTypeOf<ReadonlyArray<Json>>();
  }
}

function expectWritableJsonObjectNarrowing(value: WritableJson): void {
  if (isWritableJsonObject(value)) {
    expectTypeOf(value).toEqualTypeOf<WritableJsonObject>();
  }
}

function expectUnknownWritableJsonObjectNarrowing(value: unknown): void {
  if (isWritableJsonObjectFromUnknown(value)) {
    expectTypeOf(value).toEqualTypeOf<WritableJsonObject>();
  }
}

function expectUnknownWritableJsonNarrowing(value: unknown): void {
  if (isWritableJsonFromUnknown(value)) {
    expectTypeOf(value).toEqualTypeOf<WritableJson>();
  }
}

function expectUnknownJsonObjectNarrowing(value: unknown): void {
  if (isJsonObjectFromUnknown(value)) {
    expectTypeOf(value).toEqualTypeOf<JsonObject>();
  }
}

describe("protocol JSON", () => {
  it("uses one exact runtime contract for both exported JSON schemas", () => {
    const symbolProperty = { value: true, [Symbol("hidden")]: false };

    expect(JsonSchema).toBe(JsonValue);
    for (const invalidValue of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(0),
      symbolProperty,
    ]) {
      expect(() => decodeJson(invalidValue)).toThrow();
      expect(() => decodeJsonSchema(invalidValue)).toThrow();
    }
  });

  it("provides a writable compatibility shape without changing canonical JSON", () => {
    const writable = { nested: [1] } satisfies WritableJson;

    writable.nested.push(2);

    expect(writable).toEqual({ nested: [1, 2] });
    expect(isWritableJsonObject(writable)).toBe(true);
    expectTypeOf(writable).toMatchTypeOf<WritableJson>();
    expectTypeOf<WritableJson>().toMatchTypeOf<Json>();
    expectWritableJsonObjectNarrowing(writable);
    expectUnknownWritableJsonNarrowing(writable);
    expect(isWritableJsonFromUnknown(writable)).toBe(true);
    expect(isWritableJsonFromUnknown(Number.NaN)).toBe(false);
  });

  it("accepts finite plain JSON values", () => {
    const nullPrototypeObject: Record<string, unknown> = {
      nested: [null, true, 1, "value"],
    };
    Object.setPrototypeOf(nullPrototypeObject, null);

    expect(isJson(nullPrototypeObject)).toBe(true);
    expect(decodeJson(nullPrototypeObject)).toEqual(nullPrototypeObject);
  });

  it("rejects sparse arrays from the shared JSON contract", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;

    expect(isJson(sparse)).toBe(false);
    expect(() => decodeJson(sparse)).toThrow();
  });

  it("rejects sparse arrays with inherited indexed values", () => {
    const inheritedItems = Object.create(Array.prototype) as unknown[];
    inheritedItems[0] = true;
    const sparse: unknown[] = [];
    Object.setPrototypeOf(sparse, inheritedItems);
    sparse.length = 1;

    expect(Object.hasOwn(sparse, 0)).toBe(false);
    expect(sparse[0]).toBe(true);
    expect(isJson(sparse)).toBe(false);
    expect(() => decodeJson(sparse)).toThrow();
    expect(() =>
      encodeCanonicalJson(sparse as Json[], failCanonicalJsonEncoding),
    ).toThrow("missingArrayItem");
  });

  it("rejects cyclic JSON candidates without rejecting shared acyclic values", () => {
    const cyclicObject: Record<string, unknown> = {};
    cyclicObject.self = cyclicObject;
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    const shared = { value: true };

    expect(isJson(cyclicObject)).toBe(false);
    expect(isJson(cyclicArray)).toBe(false);
    expect(isJson({ left: shared, right: shared })).toBe(true);
    expect(isJsonObjectFromUnknown(cyclicObject)).toBe(false);
    expect(isWritableJsonObjectFromUnknown(cyclicObject)).toBe(false);
  });

  it("validates deeply nested JSON without consuming the JavaScript call stack", () => {
    let valid: unknown = true;
    let invalid: unknown = Number.POSITIVE_INFINITY;
    for (let depth = 0; depth < 10_000; depth += 1) {
      valid = { nested: valid };
      invalid = { nested: invalid };
    }

    expect(isJsonObjectFromUnknown(valid)).toBe(true);
    expect(isJsonObjectFromUnknown(invalid)).toBe(false);
    expect(() => decodeJsonSchema(valid)).not.toThrow();
  });

  it("preserves container evaluation order and native defects", () => {
    let laterObjectRead = false;
    const object: Record<string, unknown> = {
      first: Number.POSITIVE_INFINITY,
    };
    Object.defineProperty(object, "second", {
      enumerable: true,
      get: () => {
        laterObjectRead = true;
        return true;
      },
    });
    expect(isJson(object)).toBe(false);
    expect(laterObjectRead).toBe(true);

    let laterArrayRead = false;
    const array: unknown[] = [Number.POSITIVE_INFINITY, true];
    Object.defineProperty(array, 1, {
      enumerable: true,
      get: () => {
        laterArrayRead = true;
        return true;
      },
    });
    expect(isJson(array)).toBe(false);
    expect(laterArrayRead).toBe(false);

    const defect = new Error("JSON getter defect");
    const defective: Record<string, unknown> = {};
    Object.defineProperty(defective, "value", {
      enumerable: true,
      get: () => {
        throw defect;
      },
    });
    expect(() => isJson(defective)).toThrow(defect);
  });

  it("encodes validated JSON with deterministic key order and spelling", () => {
    const value: Json = { z: -0, a: [true, null, "\n"] };

    expect(encodeCanonicalJson(value, failCanonicalJsonEncoding)).toBe(
      '{"a":[true,null,"\\n"],"z":0}',
    );
  });

  it("measures canonical UTF-8 bytes without allocating the encoding", () => {
    const values: ReadonlyArray<Json> = [
      null,
      true,
      -0,
      "quote:\" slash:\\ controls:\u0000\n",
      "unicode:é😀 lone:\ud800",
      { z: ["က", false], a: { nested: 123.5 } },
    ];
    const encoder = new TextEncoder();
    for (const value of values) {
      const bytes = encoder.encode(
        encodeCanonicalJson(value, failCanonicalJsonEncoding),
      ).byteLength;
      expect(measureCanonicalJsonUtf8Bytes(value, bytes)).toEqual({
        kind: "success",
        bytes,
      });
      expect(measureCanonicalJsonUtf8Bytes(value, bytes - 1)).toMatchObject({
        kind: "exceeded",
      });
    }
  });

  it("compares validated JSON structurally with JSON number semantics", () => {
    const left: Json = { z: [-0, { enabled: true }], a: null };
    const right: Json = { a: null, z: [0, { enabled: true }] };

    expect(jsonEqual(left, right)).toBe(true);
    expect(jsonEqual({ value: 1 }, { value: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("does not treat inherited array items as JSON equality", () => {
    const inheritedItems = Object.create(Array.prototype) as Json[];
    inheritedItems[0] = true;
    const sparse: Json[] = [];
    Object.setPrototypeOf(sparse, inheritedItems);
    sparse.length = 1;

    expect(jsonEqual(sparse, [true])).toBe(false);
    expect(jsonEqual([true], sparse)).toBe(false);
  });

  it("reports a missing typed array item as an encoding invariant failure", () => {
    const sparse: Json[] = [];
    sparse.length = 1;

    expect(() => encodeCanonicalJson(sparse, failCanonicalJsonEncoding))
      .toThrow("missingArrayItem");
  });

  it("discriminates the object member of validated JSON", () => {
    const value: Json = { nested: true };

    expect(isJsonObject(value)).toBe(true);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject("value")).toBe(false);

    expectJsonObjectNarrowing(value);
  });

  it("validates unknown input before exposing JSON object shapes", () => {
    const value: unknown = { nested: [true, null, 1, "value"] };
    const invalidValues: ReadonlyArray<unknown> = [
      [],
      new Date(0),
      { nested: Number.POSITIVE_INFINITY },
      { nested: undefined },
      { [Symbol("hidden")]: true },
    ];

    expect(isJsonObjectFromUnknown(value)).toBe(true);
    expect(isWritableJsonObjectFromUnknown(value)).toBe(true);
    for (const invalidValue of invalidValues) {
      expect(isJsonObjectFromUnknown(invalidValue)).toBe(false);
      expect(isWritableJsonObjectFromUnknown(invalidValue)).toBe(false);
    }

    expectUnknownJsonObjectNarrowing(value);
    expectUnknownWritableJsonObjectNarrowing(value);
  });

  it("discriminates the array member of validated JSON", () => {
    const value: Json = [true, null];

    expect(isJsonArray(value)).toBe(true);
    expect(isJsonArray({ nested: true })).toBe(false);
    expect(isJsonArray(null)).toBe(false);
    expect(isJsonArray("value")).toBe(false);

    expectJsonArrayNarrowing(value);
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
