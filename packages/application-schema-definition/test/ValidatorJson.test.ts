import { describe, expect, it } from "vitest";

import {
  applicationArrayValidatorJson,
  applicationIdValidatorJson,
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

  it("rejects runtime inputs outside the public ID and literal contracts", () => {
    // @ts-expect-error Deliberately exercise an untyped JavaScript caller.
    expect(() => applicationIdValidatorJson(5)).toThrow(RangeError);
    // @ts-expect-error Deliberately exercise an untyped JavaScript caller.
    expect(() => applicationLiteralValidatorJson({})).toThrow(RangeError);
  });

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

  it("uses module-captured ownership intrinsics after realm mutation", () => {
    const defineProperty = Object.defineProperty;
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    );
    const constructorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "constructor",
    );
    const zeroDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    if (freezeDescriptor === undefined) throw new Error("Missing Object.freeze.");
    if (iteratorDescriptor === undefined) {
      throw new Error("Missing Array iterator.");
    }
    if (constructorDescriptor === undefined) {
      throw new Error("Missing Array constructor.");
    }
    let validator: ReturnType<typeof applicationObjectValidatorJson>;
    let union: ReturnType<typeof applicationUnionValidatorJson>;
    try {
      defineProperty(Object, "freeze", {
        ...freezeDescriptor,
        value: () => ({ kind: "rejected", reason: "tampered freeze" }),
      });
      defineProperty(Array.prototype, Symbol.iterator, {
        ...iteratorDescriptor,
        value: function* () {
          yield [
            "polluted",
            { fieldType: { type: "any" }, optional: false },
          ];
        },
      });
      defineProperty(Array.prototype, "constructor", {
        configurable: true,
        get() {
          throw new Error("polluted array constructor");
        },
      });
      defineProperty(Array.prototype, "0", {
        configurable: true,
        set() {
          throw new Error("polluted numeric setter");
        },
      });

      validator = applicationObjectValidatorJson({
        id: {
          fieldType: applicationScalarValidatorJson("string"),
          optional: false,
        },
      });
      union = applicationUnionValidatorJson([
        applicationScalarValidatorJson("string"),
      ]);
    } finally {
      if (zeroDescriptor === undefined) {
        Reflect.deleteProperty(Array.prototype, "0");
      } else {
        defineProperty(Array.prototype, "0", zeroDescriptor);
      }
      defineProperty(Array.prototype, "constructor", constructorDescriptor);
      defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
      defineProperty(Object, "freeze", freezeDescriptor);
    }

    expect(validator).toEqual({
      type: "object",
      value: {
        id: { fieldType: { type: "string" }, optional: false },
      },
    });
    expect(Object.isFrozen(validator)).toBe(true);
    expect(union).toEqual({ type: "union", value: [{ type: "string" }] });
  });

  it("preserves owned sparse union members without prototype reads", () => {
    const members: Array<Readonly<{ readonly type: "string" }>> = [];
    Object.defineProperty(members, "length", { value: 2 });
    Object.defineProperty(members, 1, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { type: "string" },
    });

    const snapshot = snapshotApplicationValidatorJson({
      type: "union",
      value: members,
    });

    if (snapshot.type !== "union") throw new Error("Expected a union snapshot.");
    expect(snapshot.value).toHaveLength(2);
    expect(Object.hasOwn(snapshot.value, 0)).toBe(false);
    expect(Object.hasOwn(snapshot.value, 1)).toBe(true);
    expect(snapshot.value[1]).toEqual({ type: "string" });
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
