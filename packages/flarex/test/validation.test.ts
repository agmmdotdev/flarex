import { describe, expect, it } from "vitest";
import {
  validateFunctionArgs,
  validateValue,
  functionArgsToValidatorJson,
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
    ).toThrowError("$\.profile.age: Expected a finite number.");
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
