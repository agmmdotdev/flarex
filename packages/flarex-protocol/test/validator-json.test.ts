import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ValidatorJson } from "../src/validator-json";

const decodeValidatorJson = Schema.decodeUnknownSync(ValidatorJson);

describe("ValidatorJson", () => {
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
