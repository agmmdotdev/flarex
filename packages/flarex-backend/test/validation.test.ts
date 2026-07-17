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
    expect(parsed.failure.message).toBe("$validator.value.body.fieldType: Validator is required.");
    expect(() => assertValidatorJson(rawValidator, "$validator")).toThrow(
      "$validator.value.body.fieldType: Validator is required.",
    );
  });

  it("preserves first-failure order across dependent validator members", () => {
    const record = parseValidatorJson({
      type: "record",
      keys: null,
      values: null,
    }, "$validator");
    expect(Result.isFailure(record)).toBe(true);
    if (Result.isSuccess(record)) throw new Error("Expected record parsing to fail.");
    expect(record.failure).toMatchObject({
      path: "$validator.keys",
      message: "$validator.keys: Validator is required.",
    });

    const union = parseValidatorJson({
      type: "union",
      value: [
        { type: "array", value: null },
        { type: "record", keys: null, values: null },
      ],
    }, "$validator");
    expect(Result.isFailure(union)).toBe(true);
    if (Result.isSuccess(union)) throw new Error("Expected union parsing to fail.");
    expect(union.failure).toMatchObject({
      path: "$validator.value[0].value",
      message: "$validator.value[0].value: Validator is required.",
    });
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
