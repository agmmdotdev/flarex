import { describe, expect, expectTypeOf, it } from "vitest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

import {
  standardValidatorV1FromExactJsonV1,
  standardV1,
  type InferStandardFunctionArgsV1,
  type InferStandardFunctionReturnV1,
  type StandardValidatorV1,
} from "../src/authoringV1";

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

    const table = standardV1.table({
      title: standardV1.string(),
      author: standardV1.object({ name: standardV1.string() }),
    });
    table.index("by_title", ["title"]);
    table.index("by_author_name", ["author.name"]);
    // @ts-expect-error Index paths must exist in the table document.
    table.index("by_missing", ["missing"]);
    // @ts-expect-error Scalar fields do not acquire invented nested paths.
    table.index("by_nested_title", ["title.value"]);

    const dynamicPaths = standardV1.table({
      metadata: standardV1.record(
        standardV1.string(),
        standardV1.string(),
      ),
      flexible: standardV1.any(),
      choice: standardV1.union(
        standardV1.object({ nested: standardV1.string() }),
        standardV1.null(),
      ),
      items: standardV1.array(
        standardV1.object({ nested: standardV1.string() }),
      ),
    });
    // @ts-expect-error Record entries are not indexable document field paths.
    dynamicPaths.index("by_metadata", ["metadata.anyKey"]);
    dynamicPaths.index("by_flexible", ["flexible.any.path"]);
    dynamicPaths.index("by_choice", ["choice.nested"]);
    // @ts-expect-error Array element fields are not document field paths.
    dynamicPaths.index("by_array_member", ["items.nested"]);

    const widenedScalar: StandardValidatorV1<string> = standardV1.string();
    const widenedTable = standardV1.table({ title: widenedScalar });
    // @ts-expect-error Widening a scalar validator does not invent descendants.
    widenedTable.index("by_widened_scalar", ["title.value"]);
    // @ts-expect-error Placement is not part of Standard logical schemas.
    standardV1.globalTable({ title: standardV1.string() });
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

  it("authors immutable placement-free tables and indexes as canonical schema input", () => {
    const fields: {
      title: StandardValidatorV1<string>;
      author: ReturnType<typeof standardV1.object<{
        name: ReturnType<typeof standardV1.string>;
      }>>;
    } = {
      title: standardV1.literal("original"),
      author: standardV1.object({
        name: standardV1.string(),
      }),
    };
    const base = standardV1.table(fields);
    const recipes = base
      .index("by_title", ["title"])
      .index("by_author_name", ["author.name"]);
    const schema = standardV1.schema({
      recipes,
      authors: standardV1.table({ name: standardV1.string() }),
    });

    fields.title = standardV1.literal("changed");

    expect(base.indexes).toEqual([]);
    expect(recipes.indexes).toEqual([
      { descriptor: "by_title", fields: ["title"] },
      { descriptor: "by_author_name", fields: ["author.name"] },
    ]);
    expect(schema.toCanonicalInput()).toEqual({
      tables: [
        {
          logicalName: "authors",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                name: { fieldType: { type: "string" }, optional: false },
              },
            },
          },
        },
        {
          logicalName: "recipes",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                title: {
                  fieldType: { type: "literal", value: "original" },
                  optional: false,
                },
                author: {
                  fieldType: {
                    type: "object",
                    value: {
                      name: {
                        fieldType: { type: "string" },
                        optional: false,
                      },
                    },
                  },
                  optional: false,
                },
              },
            },
          },
        },
      ],
      indexes: [
        {
          tableLogicalName: "recipes",
          descriptor: "by_author_name",
          fields: ["author.name"],
        },
        {
          tableLogicalName: "recipes",
          descriptor: "by_title",
          fields: ["title"],
        },
      ],
    });
    expect(schema.canonicalInput).toBe(schema.toCanonicalInput());
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.canonicalInput.tables)).toBe(true);
    expect(Object.isFrozen(schema.canonicalInput.indexes)).toBe(true);
    expect(Object.hasOwn(schema.canonicalInput.tables[0] ?? {}, "placement"))
      .toBe(false);
  });

  it("rejects duplicate index descriptors through the shared schema contract", () => {
    const table = standardV1.table({ title: standardV1.string() })
      .index("by_title", ["title"]);

    expect(() => table.index("by_title", ["title"])).toThrow();
  });

  it("owns hostile logical table names without prototype mutation", () => {
    const tables = Object.create(null) as Record<
      string,
      ReturnType<typeof standardV1.table<{ value: ReturnType<typeof standardV1.string> }>>
    >;
    Object.defineProperty(tables, "constructor", {
      enumerable: true,
      value: standardV1.table({ value: standardV1.string() }),
    });

    const schema = standardV1.schema(tables);

    expect(schema.canonicalInput.tables[0]?.logicalName).toBe("constructor");
    expect(Object.getPrototypeOf(tables)).toBeNull();
  });
});
