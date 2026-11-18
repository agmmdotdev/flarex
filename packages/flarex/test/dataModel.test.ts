import { describe, expect, expectTypeOf, it } from "vitest";
import {
  defineSchema,
  defineTable,
  type DataModelFromSchemaDefinition,
  type DocumentByName,
  type NamedIndex,
  type NamedTableInfo,
  type WithoutSystemFields,
  type IndexRangeBuilder,
} from "../src/server";
import type { FieldTypeFromFieldPath } from "../src/dataModel";
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
      .toEqualTypeOf<readonly ["name", "_creationTime", "_id"]>();
    expectTypeOf<NamedIndex<NamedTableInfo<DataModel, "users">, "by_creation_time">>()
      .toEqualTypeOf<readonly ["_creationTime", "_id"]>();
    expectTypeOf<NamedIndex<NamedTableInfo<DataModel, "users">, "by_id">>()
      .toEqualTypeOf<readonly ["_id"]>();
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

  it("preserves object union branches and any document inference", () => {
    const roots = defineSchema({
      branches: defineTable(v.union(v.object({ kind: v.literal("a"), a: v.string() }), v.object({ kind: v.literal("b"), b: v.number() }))),
      dynamic: defineTable(v.any()), empty: defineTable(v.union()),
    });
    type Roots = DataModelFromSchemaDefinition<typeof roots>;
    type Branch = DocumentByName<Roots, "branches">;
    expectTypeOf<Extract<Branch, { kind: "a" }>>().toMatchTypeOf<{ a: string; _id: Id<"branches"> }>();
    expectTypeOf<Extract<Branch, { kind: "b" }>>().toMatchTypeOf<{ b: number; _creationTime: number }>();
    expectTypeOf<DocumentByName<Roots, "dynamic">>().toBeAny();
    expectTypeOf<DocumentByName<Roots, "empty">>().toBeNever();
    expectTypeOf<Infer<ReturnType<typeof v.commitTs>>>().toEqualTypeOf<bigint>();
    const callback = v.function({ fnType: "mutation", args: { id: v.id("users") }, returns: v.commitTs() });
    expectTypeOf<Infer<typeof callback>>().toMatchTypeOf<string>();
  });

  it("includes missing union branches and optional parents in indexed field types", () => {
    const roots = defineSchema({ branches: defineTable(v.union(
      v.object({ a: v.string(), nested: v.optional(v.object({ value: v.number() })) }),
      v.object({ b: v.number(), nested: v.object({ other: v.string() }) }),
    )).index("by_a", ["a"]).index("by_nested", ["nested.value"]) });
    type Branches = DataModelFromSchemaDefinition<typeof roots>;
    type Document = DocumentByName<Branches, "branches">;
    expectTypeOf<FieldTypeFromFieldPath<Document, "a">>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FieldTypeFromFieldPath<Document, "nested.value">>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FieldTypeFromFieldPath<{ parent?: { value: number } }, "parent.value">>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FieldTypeFromFieldPath<{ parent: null | { value: string } }, "parent.value">>().toEqualTypeOf<string | undefined>();
    // The callback is typechecked without executing a database query.
    const byA = (q: IndexRangeBuilder<Document, readonly ["a"]>) => q.eq("a", undefined);
    const byNested = (q: IndexRangeBuilder<Document, readonly ["nested.value"]>) => q.eq("nested.value", undefined);
    expect(byA).toBeTypeOf("function");
    expect(byNested).toBeTypeOf("function");
  });
});
