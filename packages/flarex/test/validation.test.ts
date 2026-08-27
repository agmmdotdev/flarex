import { describe, expect, it } from "vitest";
import {
  validateFunctionArgs,
  validateValue,
  functionArgsToValidatorJson,
  Validator,
  ValidationError,
  v,
} from "../src/values";
import { parseFlarexId } from "../src/ids";
import { assertValidatorJson } from "../src/validatorJson";

describe("runtime validation", () => {
  it("validates nested values and optional fields", () => {
    const validator = v.object({
      name: v.string(),
      profile: v.object({ age: v.number(), nickname: v.optional(v.string()) }),
    });

    expect(() => validateValue(validator, { name: "Ada", profile: { age: 20 } })).not.toThrow();
    expect(() =>
      validateValue(validator, { name: "Ada", profile: { age: "20" } }),
    ).toThrowError("$\.profile.age: Expected a number.");
  });

  it("rejects missing and extra function arguments", () => {
    const args = { name: v.string(), limit: v.optional(v.number()) };

    expect(() => validateFunctionArgs(args, { name: "Ada" })).not.toThrow();
    expect(() => validateFunctionArgs(args, {})).toThrowError("$args.name: Required field is missing.");
    expect(() => validateFunctionArgs(args, { name: "Ada", extra: true })).toThrowError(
      "$args.extra: Field is not allowed.",
    );
    expect(functionArgsToValidatorJson(args)).toEqual({
      type: "object",
      value: {
        name: { fieldType: { type: "string" }, optional: false },
        limit: { fieldType: { type: "number" }, optional: true },
      },
    });
  });

  it("validates arrays, records, literals, and unions", () => {
    const validator = v.object({
      tags: v.array(v.string()),
      scores: v.record(v.string(), v.number()),
      role: v.union(v.literal("student"), v.literal("teacher")),
    });

    expect(() =>
      validateValue(validator, {
        tags: ["english"],
        scores: { vocabulary: 10 },
        role: "student",
      }),
    ).not.toThrow();
    expect(() =>
      validateValue(validator, {
        tags: ["english"],
        scores: { vocabulary: 10 },
        role: "admin",
      }),
    ).toThrowError(ValidationError);
  });

  it("constructs exact validators after same-realm intrinsic mutation", () => {
    const defineProperty = Object.defineProperty;
    const deleteProperty = Reflect.deleteProperty;
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
    const createDescriptor = Object.getOwnPropertyDescriptor(Object, "create");
    const entriesDescriptor = Object.getOwnPropertyDescriptor(Object, "entries");
    const definePropertyDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "defineProperty",
    );
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    );
    const mapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "map");
    const constructorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "constructor",
    );
    const zeroDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    if (
      freezeDescriptor === undefined ||
      createDescriptor === undefined ||
      entriesDescriptor === undefined ||
      definePropertyDescriptor === undefined ||
      iteratorDescriptor === undefined ||
      mapDescriptor === undefined ||
      constructorDescriptor === undefined
    ) throw new Error("Missing intrinsic descriptor.");
    let validator: ReturnType<typeof v.object>;
    try {
      defineProperty(Array.prototype, "0", {
        configurable: true,
        set() {
          throw new Error("polluted numeric setter");
        },
      });
      defineProperty(Array.prototype, "constructor", {
        configurable: true,
        get() {
          throw new Error("polluted array constructor");
        },
      });
      defineProperty(Array.prototype, Symbol.iterator, {
        ...iteratorDescriptor,
        value: function* () {
          yield { json: { type: "any" } };
        },
      });
      defineProperty(Array.prototype, "map", {
        ...mapDescriptor,
        value: () => [{ type: "any" }],
      });
      defineProperty(Object, "freeze", {
        ...freezeDescriptor,
        value: () => ({ kind: "polluted-freeze" }),
      });
      defineProperty(Object, "create", {
        ...createDescriptor,
        value: () => { throw new Error("polluted create"); },
      });
      defineProperty(Object, "entries", {
        ...entriesDescriptor,
        value: () => [],
      });
      defineProperty(Object, "defineProperty", {
        ...definePropertyDescriptor,
        value: () => { throw new Error("polluted defineProperty"); },
      });

      validator = v.object({
        id: v.string(),
        role: v.union(v.literal("reader"), v.literal("writer")),
      });
    } finally {
      defineProperty(Object, "defineProperty", definePropertyDescriptor);
      defineProperty(Object, "entries", entriesDescriptor);
      defineProperty(Object, "create", createDescriptor);
      defineProperty(Object, "freeze", freezeDescriptor);
      defineProperty(Array.prototype, "map", mapDescriptor);
      defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
      defineProperty(Array.prototype, "constructor", constructorDescriptor);
      if (zeroDescriptor === undefined) {
        deleteProperty(Array.prototype, "0");
      } else {
        defineProperty(Array.prototype, "0", zeroDescriptor);
      }
    }

    expect(validator.json).toEqual({
      type: "object",
      value: {
        id: { fieldType: { type: "string" }, optional: false },
        role: {
          fieldType: {
            type: "union",
            value: [
              { type: "literal", value: "reader" },
              { type: "literal", value: "writer" },
            ],
          },
          optional: false,
        },
      },
    });
    expect(Object.isFrozen(validator)).toBe(true);
  });

  it("uses the protocol number domain and rejects non-Flarex values", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      expect(() => validateValue(v.number(), value)).not.toThrow();
    }
    expect(() => validateValue(v.any(), new Date())).toThrow(
      "$: Expected a valid Flarex value.",
    );
  });

  it("rejects schema literals that the protocol cannot persist", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      expect(() => v.literal(value)).toThrow(RangeError);
    }
    expect(() => new Validator(
      "literal",
      { type: "literal", value: Number.NaN },
      "required",
    )).toThrow();
  });

  it("does not trust structurally forged validator facades", () => {
    const malformed = {
      isFlarexValidator: true,
      json: { type: "not-a-validator" },
    };
    // @ts-expect-error Deliberately exercise an untyped JavaScript caller.
    expect(() => validateValue(malformed, "anything")).toThrow(
      "$validator.json: Invalid validator JSON.",
    );
  });

  it("does not launder forged validators through facade composition", () => {
    const malformed = {
      isFlarexValidator: true,
      kind: "forged",
      json: { type: "not-a-validator" },
      isOptional: "required",
      asOptional: () => v.any(),
    };
    const forged = malformed as unknown as Validator<never>;
    const forgedString = malformed as unknown as Validator<string>;

    const compositions = [
      () => v.array(forged),
      () => v.object({ value: forged }),
      () => v.record(forgedString, v.any()),
      () => v.record(v.string(), forged),
      () => v.union(forged, v.any()),
      () => v.optional(forged),
      () => v.nullable(forged),
    ];

    for (const compose of compositions) {
      expect(compose).toThrow('got "not-a-validator"');
    }
  });

  it("rejects untyped facade inputs outside ID and literal contracts", () => {
    // @ts-expect-error Deliberately exercise an untyped JavaScript caller.
    expect(() => v.id(5)).toThrow(RangeError);
    // @ts-expect-error Deliberately exercise an untyped JavaScript caller.
    expect(() => v.literal({})).toThrow(RangeError);
  });

  it("preserves unexpected normalization defects", () => {
    const defect = new Error("hostile proxy defect");
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw defect;
      },
    });

    expect(() => validateValue(v.any(), hostile)).toThrow(defect);
  });

  it("preserves domain errors at generic record boundaries", () => {
    for (const value of [null, []]) {
      expect(() => validateValue(v.object({}), value)).toThrow(
        "$: Expected an object.",
      );
      expect(() => validateValue(v.record(v.string(), v.any()), value)).toThrow(
        "$: Expected an object.",
      );
    }
    expect(() => assertValidatorJson([], "$custom")).toThrow(
      "$custom: Expected validator object.",
    );
  });

  it("delegates ID table checks to an optional resolver", () => {
    const validator = v.object({ userId: v.id("users") });
    const tableIds = new Map([
      ["users", 1],
      ["teams", 2],
    ]);
    const validateId = (tableName: string, value: string, path: string) => {
      if (parseFlarexId(value)?.tableId !== tableIds.get(tableName)) {
        throw new ValidationError(`Expected an ID for table ${tableName}.`, path);
      }
    };

    expect(() =>
      validateValue(validator, { userId: "1:ada" }, "$", { validateId }),
    ).not.toThrow();
    expect(() =>
      validateValue(validator, { userId: "2:core" }, "$", { validateId }),
    ).toThrowError("$.userId: Expected an ID for table users.");
  });

  it("treats reserved object names as own validator and value fields", () => {
    for (const fieldName of ["__proto__", "constructor", "toString"]) {
      const fields = Object.fromEntries([[
        fieldName,
        { fieldType: { type: "string" }, optional: false },
      ]]);
      const parsed = assertValidatorJson({ type: "object", value: fields });
      if (parsed === null || parsed.type !== "object") {
        throw new Error("Expected an object validator.");
      }
      expect(Object.hasOwn(parsed.value, fieldName)).toBe(true);
      expect(() => validateValue(parsed, {})).toThrow(
        `$.${fieldName}: Required field is missing.`,
      );
      expect(() => validateValue(
        { type: "object", value: {} },
        Object.fromEntries([[fieldName, "value"]]),
      )).toThrow(`$.${fieldName}: Field is not allowed.`);
      expect(() => validateValue(
        parsed,
        Object.fromEntries([[fieldName, "value"]]),
      )).not.toThrow();
    }
  });
});
