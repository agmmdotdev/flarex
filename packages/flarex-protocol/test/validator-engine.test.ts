import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  ValidatorValueErrorV1,
  validateValidatorValueV1,
} from "../src/validator-engine";
import { normalizeFlarexValueV1 } from "../src/value";
import type { ValidatorJsonV1 } from "../src/validator-json";

describe("ValidatorJsonV1 execution", () => {
  it("validates the complete normalized scalar domain", () => {
    for (const [validator, value] of [
      [{ type: "null" }, null],
      [{ type: "number" }, Number.NaN],
      [{ type: "number" }, Number.POSITIVE_INFINITY],
      [{ type: "number" }, -0],
      [{ type: "bigint" }, -(1n << 63n)],
      [{ type: "boolean" }, true],
      [{ type: "string" }, "value"],
      [{ type: "bytes" }, new ArrayBuffer(2)],
    ] satisfies ReadonlyArray<readonly [ValidatorJsonV1, unknown]>) {
      expect(Result.isSuccess(validateValidatorValueV1(
        validator,
        normalizeFlarexValueV1(value).value,
        { idPolicy: { mode: "shapeOnly" } },
      ))).toBe(true);
    }

    const failure = validateValidatorValueV1(
      { type: "number" },
      normalizeFlarexValueV1("not-a-number").value,
      { path: "$args.count", idPolicy: { mode: "shapeOnly" } },
    );
    expect(failure).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "ValidatorValueErrorV1",
        issue: {
          reason: "typeMismatch",
          path: "$args.count",
          expected: "number",
        },
      },
    });
  });

  it("matches numeric literals with Convex float64 total equality", () => {
    const firstNaN = float64FromBits(0x7ff8_0000_0000_0001n);
    const secondNaN = float64FromBits(0x7ff8_0000_0000_0002n);
    const options = { idPolicy: { mode: "shapeOnly" as const } };

    expect(Result.isSuccess(validateValidatorValueV1(
      { type: "literal", value: firstNaN },
      normalizeFlarexValueV1(firstNaN).value,
      options,
    ))).toBe(true);
    expect(Result.isFailure(validateValidatorValueV1(
      { type: "literal", value: firstNaN },
      normalizeFlarexValueV1(secondNaN).value,
      options,
    ))).toBe(true);
    expect(Result.isSuccess(validateValidatorValueV1(
      { type: "literal", value: 0 },
      normalizeFlarexValueV1(0).value,
      options,
    ))).toBe(true);
    expect(Result.isFailure(validateValidatorValueV1(
      { type: "literal", value: 0 },
      normalizeFlarexValueV1(-0).value,
      options,
    ))).toBe(true);
  });

  it("enforces strict objects, optional omission, arrays, and records", () => {
    const validator: ValidatorJsonV1 = {
      type: "object",
      value: {
        items: {
          optional: false,
          fieldType: { type: "array", value: { type: "number" } },
        },
        labels: {
          optional: false,
          fieldType: {
            type: "record",
            keys: { type: "string" },
            values: { type: "boolean" },
          },
        },
        note: { optional: true, fieldType: { type: "string" } },
      },
    };
    const normalized = normalizeFlarexValueV1({
      items: [1, 2],
      labels: { ready: true },
      note: undefined,
    });
    expect(Result.isSuccess(validateValidatorValueV1(
      validator,
      normalized.value,
      { path: "$args", idPolicy: { mode: "shapeOnly" } },
    ))).toBe(true);

    const extra = validateValidatorValueV1(
      validator,
      normalizeFlarexValueV1({
        items: [1],
        labels: {},
        "not.valid": true,
      }).value,
      { path: "$args", idPolicy: { mode: "shapeOnly" } },
    );
    expect(extra).toMatchObject({
      failure: {
        issue: {
          reason: "unexpectedField",
          path: '$args["not.valid"]',
        },
      },
    });
  });

  it("keeps union failures as data and never swallows ID-policy defects", () => {
    const union: ValidatorJsonV1 = {
      type: "union",
      value: [{ type: "number" }, { type: "string" }],
    };
    expect(Result.isSuccess(validateValidatorValueV1(
      union,
      normalizeFlarexValueV1("later-member").value,
      { idPolicy: { mode: "shapeOnly" } },
    ))).toBe(true);
    expect(validateValidatorValueV1(
      union,
      normalizeFlarexValueV1(false).value,
      { path: "$args.value", idPolicy: { mode: "shapeOnly" } },
    )).toMatchObject({
      failure: {
        issue: {
          reason: "unionMismatch",
          path: "$args.value",
          memberCount: 2,
        },
      },
    });

    const defect = new Error("id policy defect");
    expect(() => validateValidatorValueV1(
      {
        type: "union",
        value: [{ type: "id", tableName: "users" }, { type: "string" }],
      },
      normalizeFlarexValueV1("1:018f22e2-58cc-7b2a-91d8-f3f3401a0874").value,
      {
        idPolicy: {
          mode: "tableAware",
          check: () => {
            throw defect;
          },
        },
      },
    )).toThrow(defect);
  });

  it("distinguishes malformed IDs from unavailable table authority", () => {
    const validator: ValidatorJsonV1 = {
      type: "id",
      tableName: "users",
    };
    const normalized = normalizeFlarexValueV1("malformed").value;
    const invalid = validateValidatorValueV1(validator, normalized, {
      path: "$args.userId",
      idPolicy: { mode: "tableAware", check: () => "invalid" },
    });
    const unavailable = validateValidatorValueV1(validator, normalized, {
      path: "$args.userId",
      idPolicy: { mode: "tableAware", check: () => "unavailable" },
    });
    expect(invalid).toMatchObject({
      failure: { issue: { reason: "idMismatch" } },
    });
    expect(unavailable).toMatchObject({
      failure: { issue: { reason: "idAuthorityUnavailable" } },
    });
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toBeInstanceOf(ValidatorValueErrorV1);
      expect(invalid.failure.message).not.toContain("malformed");
    }
  });

  it("provides the exact field path to table-aware ID policy", () => {
    const observations: Array<readonly [string, string, string]> = [];
    const result = validateValidatorValueV1(
      {
        type: "object",
        value: {
          ownerId: {
            optional: false,
            fieldType: { type: "id", tableName: "users" },
          },
        },
      },
      normalizeFlarexValueV1({ ownerId: "1:user" }).value,
      {
        path: "$args",
        idPolicy: {
          mode: "tableAware",
          check: (tableName, value, path) => {
            observations.push([tableName, value, path]);
            return "valid";
          },
        },
      },
    );

    expect(Result.isSuccess(result)).toBe(true);
    expect(observations).toEqual([["users", "1:user", "$args.ownerId"]]);
  });
});

function float64FromBits(bits: bigint): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}
