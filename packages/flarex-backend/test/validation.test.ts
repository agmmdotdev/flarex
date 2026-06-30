import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  assertValidatorJson,
  BackendValidationError,
  parseValidatorJson,
  validateJsonValueEffect,
} from "../src/validation";

describe("backend validator metadata parsing", () => {
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

    expect(parsed).toEqual({
      success: true,
      value: {
        type: "object",
        value: {
          body: {
            fieldType: { type: "array", value: { type: "string" } },
            optional: false,
          },
        },
      },
    });
    expect(assertValidatorJson(rawValidator, "$validator")).toEqual(
      parsed.success ? parsed.value : null,
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

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected validator metadata parsing to fail.");
    }
    expect(parsed.error).toBeInstanceOf(BackendValidationError);
    expect(parsed.error.message).toBe("$validator.value.body.fieldType: Validator is required.");
    expect(() => assertValidatorJson(rawValidator, "$validator")).toThrow(
      "$validator.value.body.fieldType: Validator is required.",
    );
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
