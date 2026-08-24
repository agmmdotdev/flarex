import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeValidatorJsonV1,
  ValidatorJson,
} from "../src/validator-json";

const decodeValidatorJson = Schema.decodeUnknownSync(ValidatorJson);

describe("ValidatorJson", () => {
  it("exposes the admission-bounded protocol decoder", () => {
    expect(decodeValidatorJsonV1({
      type: "array",
      value: { type: "string" },
    })).toEqual({
      type: "array",
      value: { type: "string" },
    });

    const cyclic: { type: "array"; value?: unknown } = { type: "array" };
    cyclic.value = cyclic;
    expect(() => decodeValidatorJsonV1(cyclic)).toThrow(
      "Validator JSON admission failed: tooDeep.",
    );
  });

  it("requires ID validators to name a non-empty table", () => {
    expect(decodeValidatorJson({ type: "id", tableName: "users" })).toEqual({
      type: "id",
      tableName: "users",
    });
    expect(() => decodeValidatorJson({ type: "id", tableName: "" })).toThrow();
  });

  it("requires numeric literals to be finite", () => {
    expect(decodeValidatorJson({
      type: "literal",
      value: Number.MAX_VALUE,
    })).toEqual({
      type: "literal",
      value: Number.MAX_VALUE,
    });
    for (
      const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -0,
      ]
    ) {
      expect(() => decodeValidatorJson({
        type: "literal",
        value,
      })).toThrow();
    }
  });
});
