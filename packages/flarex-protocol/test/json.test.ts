import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  encodeCanonicalJson,
  isJson,
  isJsonArray,
  isJsonObject,
  isWritableJsonObject,
  isWritableJsonObjectFromUnknown,
  jsonEqual,
  JsonValue,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
  type JsonObject,
  type WritableJson,
  type WritableJsonObject,
} from "../src/json";

const decodeJson = Schema.decodeUnknownSync(JsonValue);

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

describe("protocol JSON", () => {
  it("provides a writable compatibility shape without changing canonical JSON", () => {
    const writable = { nested: [1] } satisfies WritableJson;

    writable.nested.push(2);

    expect(writable).toEqual({ nested: [1, 2] });
    expect(isWritableJsonObject(writable)).toBe(true);
    expectTypeOf(writable).toMatchTypeOf<WritableJson>();
    expectTypeOf<WritableJson>().toMatchTypeOf<Json>();
    expectWritableJsonObjectNarrowing(writable);
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
    expect(isWritableJsonObjectFromUnknown(cyclicObject)).toBe(false);
  });

  it("encodes validated JSON with deterministic key order and spelling", () => {
    const value: Json = { z: -0, a: [true, null, "\n"] };

    expect(encodeCanonicalJson(value, failCanonicalJsonEncoding)).toBe(
      '{"a":[true,null,"\\n"],"z":0}',
    );
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

  it("validates unknown input before exposing a writable JSON object", () => {
    const value: unknown = { nested: [true, null, 1, "value"] };

    expect(isWritableJsonObjectFromUnknown(value)).toBe(true);
    expect(isWritableJsonObjectFromUnknown([])).toBe(false);
    expect(isWritableJsonObjectFromUnknown(new Date(0))).toBe(false);
    expect(
      isWritableJsonObjectFromUnknown({ nested: Number.POSITIVE_INFINITY }),
    ).toBe(false);
    expect(isWritableJsonObjectFromUnknown({ nested: undefined })).toBe(false);
    expect(isWritableJsonObjectFromUnknown({ [Symbol("hidden")]: true })).toBe(false);

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
