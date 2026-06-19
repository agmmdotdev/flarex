import { describe, expect, it } from "vitest";
import {
  defineColocatedTable,
  defineGlobalTable,
  definePartitionTable,
  defineSchema,
  v,
} from "../src";

describe("schema builders", () => {
  it("records partition placement and indexes", () => {
    const schema = defineSchema({
      users: definePartitionTable({ name: v.string() }),
      progress: defineColocatedTable("users", "userId", { userId: v.id("users") })
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
      catalog: defineGlobalTable({ sku: v.string() }),
    });

    expect(schema.tables.catalog).toMatchObject({
      kind: "table",
      placement: { kind: "global" },
    });
  });

  it("records explicit partition table placement", () => {
    const schema = defineSchema({
      documents: definePartitionTable({
        title: v.string(),
      }).index("by_title", ["title"]),
    });

    expect(schema.tables.documents).toMatchObject({
      kind: "table",
      placement: { kind: "partitionBy", field: "_id" },
      indexes: [{ name: "by_title", fields: ["title"] }],
    });
  });

  it("records explicit colocated table placement", () => {
    const schema = defineSchema({
      documents: definePartitionTable({
        title: v.string(),
      }),
      comments: defineColocatedTable("documents", "documentId", {
        documentId: v.id("documents"),
        body: v.string(),
      }).index("by_document", ["documentId"]),
    });

    expect(schema.tables.comments).toMatchObject({
      kind: "table",
      placement: { kind: "colocateWith", table: "documents", field: "documentId" },
      indexes: [{ name: "by_document", fields: ["documentId"] }],
    });
  });

  it("records explicit global table placement", () => {
    const schema = defineSchema({
      appSettings: defineGlobalTable({
        key: v.string(),
        value: v.string(),
      }),
    });

    expect(schema.tables.appSettings).toMatchObject({
      kind: "table",
      placement: { kind: "global" },
    });
  });
});
