import { describe, expect, it } from "vitest";
import { defineSchema, defineTable, v } from "../src";

describe("schema builders", () => {
  it("records partition placement and indexes", () => {
    const schema = defineSchema({
      users: defineTable({ name: v.string() }).partitionBy("_id"),
      progress: defineTable({ userId: v.id("users") })
        .colocateWith("users", "userId")
        .index("by_user", ["userId"]),
    });

    expect(schema.tables.progress).toMatchObject({
      kind: "table",
      placement: { kind: "colocateWith", table: "users", field: "userId" },
      indexes: [{ name: "by_user", fields: ["userId"] }],
    });
  });

  it("records global placement explicitly", () => {
    const schema = defineSchema({
      catalog: defineTable({ sku: v.string() }).global(),
    });

    expect(schema.tables.catalog).toMatchObject({
      kind: "table",
      placement: { kind: "global" },
    });
  });
});
