import { Effect, Result } from "effect";
import type { ValidatorJson as ProtocolValidatorJson } from "flarex-protocol/validator-json";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertValidatorJson,
  BackendValidationError,
  parseValidatorJson,
  validateJsonValue,
  validateJsonValueEffect,
} from "../src/validation";
import type { ValidatorJson as BackendValidatorJson } from "../src/types";

describe("backend validator metadata parsing", () => {
  it("uses the protocol-owned ValidatorJson contract", () => {
    expectTypeOf<BackendValidatorJson>().toEqualTypeOf<ProtocolValidatorJson>();
  });

  it("parses validator metadata through a non-throwing result helper", () => {
    const rawValidator = {
      type: "object",
      value: {
        body: {
          fieldType: { type: "array", value: { type: "string" } },
          optional: false,
        },
      },
    } as const;

    const parsed = parseValidatorJson(rawValidator, "$validator");

    expect(parsed).toEqual(Result.succeed({
      type: "object",
      value: {
        body: {
          fieldType: { type: "array", value: { type: "string" } },
          optional: false,
        },
      },
    }));
    expect(assertValidatorJson(rawValidator, "$validator")).toEqual(
      Result.getOrNull(parsed),
    );
  });

  it("returns typed validation errors while preserving assertValidatorJson compatibility", () => {
    const rawValidator = {
      type: "object",
      value: {
        body: { optional: false },
      },
    } as const;

    const parsed = parseValidatorJson(rawValidator, "$validator");

    expect(Result.isFailure(parsed)).toBe(true);
    if (Result.isSuccess(parsed)) {
      throw new Error("Expected validator metadata parsing to fail.");
    }
    expect(parsed.failure).toBeInstanceOf(BackendValidationError);
    expect(parsed.failure.path).toBe('$validator["value"]["body"]["fieldType"]');
    expect(parsed.failure.message).toBe('$validator["value"]["body"]["fieldType"]: Invalid validator JSON (missingProperty).');
    expect(() => assertValidatorJson(rawValidator, "$validator")).toThrow(parsed.failure.message);
  });

  it("preserves first-failure order across dependent validator members", () => {
    const record = parseValidatorJson({
      type: "record",
      keys: null,
      values: null,
    }, "$validator");
    expect(Result.isFailure(record)).toBe(true);
    if (Result.isSuccess(record)) throw new Error("Expected record parsing to fail.");
    expect(record.failure.path).toBe('$validator["keys"]');
    expect(record.failure.message).toBe('$validator["keys"]: Invalid validator JSON (malformedContainer).');

    const union = parseValidatorJson({
      type: "union",
      value: [
        { type: "array", value: null },
        { type: "record", keys: null, values: null },
      ],
    }, "$validator");
    expect(Result.isFailure(union)).toBe(true);
    if (Result.isSuccess(union)) throw new Error("Expected union parsing to fail.");
    expect(union.failure.path).toBe('$validator["value"][0]["value"]');
    expect(union.failure.message).toBe('$validator["value"][0]["value"]: Invalid validator JSON (malformedContainer).');
  });

  it("rejects object validator metadata with an absent field map", () => {
    const result = parseValidatorJson({ type: "object" }, "$validator");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) throw new Error("Expected missing field map to fail.");
    expect(result.failure.path).toBe('$validator["value"]');
    expect(result.failure.message).toBe('$validator["value"]: Invalid validator JSON (malformedContainer).');
  });
  it("treats reserved object names as own validator and document fields", () => {
    for (const fieldName of ["__proto__", "constructor", "toString"]) {
      const rawFields = Object.fromEntries([[
        fieldName,
        { fieldType: { type: "string" }, optional: false },
      ]]);
      const parsed = Result.getOrThrow(parseValidatorJson({
        type: "object",
        value: rawFields,
      }, "$validator"));
      if (parsed === null || parsed.type !== "object") {
        throw new Error("Expected an object validator.");
      }
      expect(Object.hasOwn(parsed.value, fieldName)).toBe(true);
      expect(() => validateJsonValue(parsed, {}, "$document")).toThrow(
        `$document.${fieldName}: Required field is missing.`,
      );
      expect(() => validateJsonValue(
        { type: "object", value: {} },
        Object.fromEntries([[fieldName, "value"]]),
        "$document",
      )).toThrow(`$document.${fieldName}: Field is not allowed.`);
      expect(() => validateJsonValue(
        parsed,
        Object.fromEntries([[fieldName, "value"]]),
        "$document",
      )).not.toThrow();
    }
  });

  it("decodes exact literal metadata while keeping the retained JSON transport closed", () => {
    const int64 = Result.getOrThrow(parseValidatorJson({ type: "literal", value: { $integer: "AQAAAAAAAAA=" } }, "$validator"));
    expect(int64).toEqual({ type: "literal", value: 1n });
    if (int64 === null) throw new Error("Expected an int64 literal.");
    expect(() => validateJsonValue(int64, { $integer: "AQAAAAAAAAA=" })).toThrow("Bigint transport is not implemented.");
    const negativeZero = Result.getOrThrow(parseValidatorJson({ type: "literal", value: { $float: "AAAAAAAAAIA=" } }, "$validator"));
    if (negativeZero === null) throw new Error("Expected a signed-zero literal.");
    expect(() => validateJsonValue(negativeZero, -0)).not.toThrow();
    expect(() => validateJsonValue(negativeZero, 0)).toThrow(BackendValidationError);
    expect(Result.isFailure(parseValidatorJson({ type: "literal", value: { $integer: "AQ==" } }, "$validator"))).toBe(true);
  });

  it("exposes JSON value validation failures through an Effect boundary", async () => {
    await expect(Effect.runPromise(validateJsonValueEffect(
      { type: "object", value: { name: { fieldType: { type: "string" }, optional: false } } },
      {},
      "$args",
    ))).rejects.toMatchObject({
      path: "$args.name",
      message: "$args.name: Required field is missing.",
    });
  });
});
