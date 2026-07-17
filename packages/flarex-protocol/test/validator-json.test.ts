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
});
