import { describe, expect, expectTypeOf, it } from "vitest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

import {
  standardValidatorV1FromExactJsonV1,
  standardV1,
  type InferStandardFunctionArgsV1,
  type InferStandardFunctionReturnV1,
  type StandardValidatorV1,
} from "../src/v1";

describe("Standard Application typed authoring V1", () => {
  if (false) {
    standardV1.publicQuery({
      // @ts-expect-error Function arguments must be an object or any validator.
      args: standardV1.string(),
      returns: standardV1.null(),
    });
    // @ts-expect-error Standard validator types cannot be structurally forged.
    const forged: StandardValidatorV1<string> = {
      json: { type: "number" },
      optionality: "required",
    };
    void forged;
  }

  it("lowers typed validators and function references to exact canonical input", () => {
    const recipe = standardV1.object({
      title: standardV1.string(),
      servings: standardV1.number(),
      note: standardV1.optional(standardV1.string()),
      status: standardV1.union(
        standardV1.literal("draft"),
        standardV1.literal("published"),
      ),
    });
    const create = standardV1.publicMutation({
      args: recipe,
      returns: standardV1.id("recipes"),
    });
    const module = standardV1.module("recipeCommands", { create });
    const reference = module.reference("create");

    expectTypeOf<InferStandardFunctionArgsV1<typeof create>>().toEqualTypeOf<
      Readonly<{
        readonly title: string;
        readonly servings: number;
        readonly note?: string;
        readonly status: "draft" | "published";
      }>
    >();
    expectTypeOf<InferStandardFunctionReturnV1<typeof create>>()
      .toMatchTypeOf<string>();
    expectTypeOf(reference.path).toEqualTypeOf<"recipeCommands:create">();
    expect(reference.path).toBe("recipeCommands:create");
    expect(module.toCanonicalInput()).toEqual({
      modulePath: "recipeCommands",
      functions: [{
        exportName: "create",
        kind: "mutation",
        visibility: "public",
        argsValidator: {
          type: "object",
          value: {
            title: { fieldType: { type: "string" }, optional: false },
            servings: { fieldType: { type: "number" }, optional: false },
            note: { fieldType: { type: "string" }, optional: true },
            status: {
              fieldType: {
                type: "union",
                value: [
                  { type: "literal", value: "draft" },
                  { type: "literal", value: "published" },
                ],
              },
              optional: false,
            },
          },
        },
        returnsValidator: { type: "id", tableName: "recipes" },
      }],
    });
    expect(Object.isFrozen(recipe.json)).toBe(true);
    expect(Object.hasOwn(recipe, "valueType")).toBe(false);
    expect(Object.hasOwn(recipe, "optionalityType")).toBe(false);
    expect(Object.isFrozen(recipe.json.value)).toBe(true);
    expect(Object.isFrozen(module.toCanonicalInput().functions)).toBe(true);
  });

  it("owns hostile field names without prototype mutation", () => {
    const fields = Object.create(null) as {
      __proto__: ReturnType<typeof standardV1.string>;
    };
    Object.defineProperty(fields, "__proto__", {
      enumerable: true,
      value: standardV1.string(),
    });
    const validator = standardV1.object(fields);

    expect(Object.getPrototypeOf(validator.json.value)).toBeNull();
    expect(Object.hasOwn(validator.json.value, "__proto__")).toBe(true);
  });

  it("detaches and recursively freezes an already exact protocol validator", () => {
    const fields: Record<
      string,
      { fieldType: ValidatorJsonV1; optional: boolean }
    > = Object.create(null) as Record<
      string,
      { fieldType: ValidatorJsonV1; optional: boolean }
    >;
    Object.defineProperty(fields, "__proto__", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        fieldType: { type: "array", value: { type: "string" } },
        optional: false,
      },
    });
    const source: ValidatorJsonV1 = { type: "object", value: fields };

    const validator = standardValidatorV1FromExactJsonV1(source);
    fields.__proto__ = {
      fieldType: { type: "number" },
      optional: true,
    };

    if (validator.json.type !== "object") {
      throw new Error("Expected an owned object validator.");
    }
    const hostileField = validator.json.value.__proto__;
    expect(hostileField).toEqual({
      fieldType: { type: "array", value: { type: "string" } },
      optional: false,
    });
    expect(Object.getPrototypeOf(validator.json.value)).toBeNull();
    expect(Object.isFrozen(validator.json.value)).toBe(true);
    expect(Object.isFrozen(hostileField)).toBe(true);
    expect(
      hostileField?.fieldType.type === "array" &&
        Object.isFrozen(hostileField.fieldType),
    ).toBe(true);
    expect(Object.isFrozen(fields)).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0])(
    "rejects the non-canonical numeric literal %s",
    value => {
      expect(() => standardV1.literal(value)).toThrow(RangeError);
    },
  );
});
