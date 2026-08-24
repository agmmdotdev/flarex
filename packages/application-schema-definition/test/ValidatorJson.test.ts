import { describe, expect, it } from "vitest";

import {
  applicationArrayValidatorJson,
  applicationLiteralValidatorJson,
  applicationObjectValidatorJson,
  applicationScalarValidatorJson,
  applicationUnionValidatorJson,
  snapshotApplicationValidatorJson,
} from "../src/ValidatorJson";

describe("application validator JSON authoring", () => {
  it("owns and recursively freezes composed validators", () => {
    const source = {
      type: "array",
      value: { type: "string" },
    } as const;
    const validator = applicationObjectValidatorJson({
      tags: { fieldType: source, optional: false },
    });

    expect(validator).toEqual({
      type: "object",
      value: {
        tags: {
          fieldType: { type: "array", value: { type: "string" } },
          optional: false,
        },
      },
    });
    expect(validator.value.tags?.fieldType).not.toBe(source);
    expect(Object.isFrozen(validator)).toBe(true);
    expect(Object.isFrozen(validator.value)).toBe(true);
    expect(Object.isFrozen(validator.value.tags)).toBe(true);
    expect(Object.isFrozen(validator.value.tags?.fieldType)).toBe(true);
  });

  it("preserves reserved field names as null-prototype own data", () => {
    const fields: Record<
      string,
      Readonly<{
        readonly fieldType: Readonly<{ readonly type: "string" }>;
        readonly optional: boolean;
      }>
    > = Object.create(null);
    Object.defineProperty(fields, "__proto__", {
      enumerable: true,
      value: { fieldType: { type: "string" }, optional: false },
    });

    const validator = applicationObjectValidatorJson(fields);

    expect(Object.getPrototypeOf(validator.value)).toBeNull();
    expect(Object.hasOwn(validator.value, "__proto__")).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0])(
    "rejects the non-canonical numeric literal %s",
    value => {
      expect(() => applicationLiteralValidatorJson(value)).toThrow(RangeError);
    },
  );

  it("constructs exact scalar, array, union, and detached snapshot values", () => {
    const string = applicationScalarValidatorJson("string");
    const array = applicationArrayValidatorJson(string);
    const union = applicationUnionValidatorJson([
      array,
      applicationLiteralValidatorJson("none"),
    ]);
    const snapshot = snapshotApplicationValidatorJson(union);

    expect(snapshot).toEqual(union);
    expect(snapshot).not.toBe(union);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("snapshots the complete protocol union domain including legacy empty unions", () => {
    const snapshot = snapshotApplicationValidatorJson({
      type: "union",
      value: [],
    });

    expect(snapshot).toEqual({ type: "union", value: [] });
    if (snapshot.type !== "union") throw new Error("Expected a union snapshot.");
    expect(Object.isFrozen(snapshot.value)).toBe(true);
  });
});
