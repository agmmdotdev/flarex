import { query } from "../src/server";
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

  it("constructs and exports exact owned validators while same-realm intrinsics are mutated", () => {
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
    const apply = Reflect.apply;
    const objectIsDescriptor = Object.getOwnPropertyDescriptor(Object, "is");
    const finiteDescriptor = Object.getOwnPropertyDescriptor(Number, "isFinite");
    const nanDescriptor = Object.getOwnPropertyDescriptor(Number, "isNaN");
    if (objectIsDescriptor === undefined || finiteDescriptor === undefined || nanDescriptor === undefined) throw new Error("Missing numeric intrinsic descriptor.");
    const forged = { isFlarexValidator: true, isOptional: "required", kind: "id", json: { type: "id", tableName: "" } };
    let validator: ReturnType<typeof v.object>;
    let metadata: unknown;
    let numericMetadata: unknown;
    let argsExport: string | undefined;
    let returnsExport: string | undefined;
    let mapExport: string | undefined;
    let foreignRejected = false;
    let validForeignMetadata: unknown;
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

      defineProperty(Object, "is", { ...objectIsDescriptor, value: () => false });
      defineProperty(Number, "isFinite", { ...finiteDescriptor, value: () => false });
      defineProperty(Number, "isNaN", { ...nanDescriptor, value: () => false });
      validator = v.object({
        id: v.string(),
        role: v.union(v.literal("reader"), v.literal("writer")),
      });
      metadata = validator.json;
      numericMetadata = v.object({ integer: v.literal(1n), zero: v.literal(-0), ordinary: v.literal(1), special: v.literal(Number.NaN) }).json;
      const registered = query({ args: validator, returns: v.literal(-0), handler: (): 0 => -0 });
      argsExport = registered.exportArgs();
      returnsExport = registered.exportReturns();
      mapExport = query({ args: { required: v.string(), integer: v.literal(1n) }, handler: () => null }).exportArgs();
      try { apply(v.array, undefined, [forged]); } catch { foreignRejected = true; }
      const foreignValid = { isFlarexValidator: true, isOptional: "required", kind: "literal", json: { type: "literal", value: { $integer: "AQAAAAAAAAA=" } } };
      const foreignArray: ReturnType<typeof v.array> = apply(v.array, undefined, [foreignValid]);
      validForeignMetadata = foreignArray.json;
    } finally {
      defineProperty(Number, "isNaN", nanDescriptor);
      defineProperty(Number, "isFinite", finiteDescriptor);
      defineProperty(Object, "is", objectIsDescriptor);
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

    expect(metadata).toEqual({
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
    expect(JSON.parse(argsExport ?? "null")).toEqual(metadata);
    expect(JSON.parse(returnsExport ?? "null")).toEqual({ type: "literal", value: { $float: "AAAAAAAAAIA=" } });
    expect(JSON.parse(mapExport ?? "null")).toEqual({ type: "object", value: { required: { fieldType: { type: "string" }, optional: false }, integer: { fieldType: { type: "literal", value: { $integer: "AQAAAAAAAAA=" } }, optional: false } } });
    expect(numericMetadata).toEqual({ type: "object", value: { integer: { fieldType: { type: "literal", value: { $integer: "AQAAAAAAAAA=" } }, optional: false }, zero: { fieldType: { type: "literal", value: { $float: "AAAAAAAAAIA=" } }, optional: false }, ordinary: { fieldType: { type: "literal", value: 1 }, optional: false }, special: { fieldType: { type: "literal", value: { $float: "AAAAAAAA+H8=" } }, optional: false } } });
    expect(foreignRejected).toBe(true);
    expect(validForeignMetadata).toEqual({ type: "array", value: { type: "literal", value: { $integer: "AQAAAAAAAAA=" } } });
  });

  it("exports owned metadata while same-realm Object.entries is mutated", () => {
    const validator = v.object({ required: v.string() });
    const registered = query({ args: validator, handler: () => null });
    const defineProperty = Object.defineProperty;
    const descriptor = Object.getOwnPropertyDescriptor(Object, "entries");
    if (descriptor === undefined) throw new Error("Missing Object.entries descriptor");
    let json: unknown;
    let args: string | undefined;
    try {
      defineProperty(Object, "entries", { ...descriptor, value: () => [] });
      json = validator.json;
      args = registered.exportArgs();
    } finally { defineProperty(Object, "entries", descriptor); }
    const expected = { type: "object", value: { required: { fieldType: { type: "string" }, optional: false } } };
    expect(json).toEqual(expected);
    expect(JSON.parse(args ?? "null")).toEqual(expected);
  });
  it("uses the protocol number domain and rejects non-Flarex values", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      expect(() => validateValue(v.number(), value)).not.toThrow();
    }
    expect(() => validateValue(v.any(), new Date())).toThrow(
      "$: Expected a valid Flarex value.",
    );
  });

  it("retains literal numeric identity through authoring, export and validation", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      const validator = v.literal(value);
      expect(() => validateValue(validator, value)).not.toThrow();
      expect(validator.json).toMatchObject({ type: "literal", value: { $float: expect.any(String) } });
    }
    expect(() => validateValue(v.literal(-0), 0)).toThrow(ValidationError);
    expect(() => validateValue(v.literal(0), -0)).toThrow(ValidationError);
    expect(() => validateValue(v.literal(1n), 1)).toThrow(ValidationError);
    expect(() => validateValue(v.literal(1), 1n)).toThrow(ValidationError);
    expect(v.literal(1n).json).toEqual({ type: "literal", value: { $integer: "AQAAAAAAAAA=" } });
    expect(v.literal(1).json).toEqual({ type: "literal", value: 1 });
    expect(() => new Validator("literal", { type: "literal", value: Number.NaN }, "required")).not.toThrow();
  });

  it("defers unchecked bigint overflow until export, including nested composition", () => {
    const value = 9223372036854775808n;
    const literal = v.literal(value);
    const nested = v.object({ values: v.array(literal), optional: v.optional(literal) });
    expect(() => literal.json).toThrow();
    expect(() => nested.json).toThrow();
    const minimum = v.literal(-9223372036854775808n);
    const maximum = v.literal(9223372036854775807n);
    expect(minimum.json).toEqual({ type: "literal", value: { $integer: "AAAAAAAAAIA=" } });
    expect(maximum.json).toEqual({ type: "literal", value: { $integer: "/////////38=" } });
    expect(() => validateValue(minimum, -9223372036854775808n)).not.toThrow();
    expect(() => validateValue(maximum, 9223372036854775807n)).not.toThrow();
  });

  it("refuses foreign export accessors without invoking them", () => {
    let reads = 0;
    const foreign = {
      isFlarexValidator: true,
      isOptional: "required",
      get json() { reads += 1; return v.literal(1n).json; },
    };
    expect(() => validateValue(foreign as never, 1n)).toThrow("own data property");
    expect(reads).toBe(0);
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
      expect(compose).toThrow("$validator.json: Invalid validator JSON.");
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
