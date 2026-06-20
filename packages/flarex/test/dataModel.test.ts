import { describe, expect, expectTypeOf, it } from "vitest";
import {
  defineSchema,
  defineTable,
  type DataModelFromSchemaDefinition,
  type DocumentByName,
  type NamedIndex,
  type NamedTableInfo,
  type WithoutSystemFields,
} from "../src/server";
import { v, type Id, type Infer } from "../src/values";

const schema = defineSchema({
  users: defineTable({
    name: v.string(),
    nickname: v.optional(v.string()),
    role: v.union(v.literal("student"), v.literal("teacher")),
  }).index("by_name", ["name"]),
});

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type User = DocumentByName<DataModel, "users">;

describe("typed schema data model", () => {
  it("infers validator and document types", () => {
    expectTypeOf<Infer<ReturnType<typeof v.string>>>().toEqualTypeOf<string>();
    expectTypeOf<User>().toMatchTypeOf<{
      _id: Id<"users">;
      _creationTime: number;
      name: string;
      nickname?: string;
      role: "student" | "teacher";
    }>();
    expectTypeOf<WithoutSystemFields<User>>().toMatchTypeOf<{
      name: string;
      nickname?: string;
      role: "student" | "teacher";
    }>();
    expectTypeOf<NamedIndex<NamedTableInfo<DataModel, "users">, "by_name">>()
      .toEqualTypeOf<readonly ["name"]>();
  });

  it("exports Convex-style validator metadata", () => {
    expect(v.optional(v.string()).isOptional).toBe("optional");
    expect(v.object({ name: v.string(), age: v.optional(v.number()) }).json).toEqual({
      type: "object",
      value: {
        name: { fieldType: { type: "string" }, optional: false },
        age: { fieldType: { type: "number" }, optional: true },
      },
    });
  });
});
