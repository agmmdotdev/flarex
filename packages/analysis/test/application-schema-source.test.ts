import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { prepareApplicationSchemaSource, requirePreparedApplicationSchemaSource } from "../src/logicalApplicationSource";

describe("analyzer-issued Application schema sources", () => {
  it("analyzes the actual SDK schema without inventing a function or execution artifact", async () => {
    const prepared = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({
      users: defineTable({ name: v.string() }).index("by_name", ["name"]),
    })));
    expect(Result.isSuccess(requirePreparedApplicationSchemaSource(prepared))).toBe(true);
    expect(prepared.source.owner).toBe("application");
    expect(prepared.source.evidence).toEqual({ format: "flarex.application-schema-analysis", version: 1,
      placements: [{ table: "users", placement: { kind: "partitionBy", field: "_id" } }] });
    expect(prepared.source.definition).toMatchObject({ kind: "documents",
      tables: [{ logicalName: "users", definition: { definitionVersion: 2, documentType: { type: "object" } } }],
      indexes: [{ tableLogicalName: "users", descriptor: "by_name", fields: ["name"] }],
      uniqueConstraints: [], relations: [] });
    expect(Object.isFrozen(prepared.source.definition)).toBe(true);
    expect(prepared.source.bindings).toEqual([{ kind: "definition", localName: "users", table: { namespace: "app", logicalName: "users" } }]);
  });

  it("refuses a structural copy of an authentic source capability", async () => {
    const prepared = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({ users: defineTable({ name: v.string() }) })));
    expect(Result.isFailure(requirePreparedApplicationSchemaSource({ ...prepared }))).toBe(true);
    expect(Result.isSuccess(requirePreparedApplicationSchemaSource(prepared))).toBe(true);
  });

  it("keeps schema analysis errors and unsupported placement before issuance", async () => {
    const malformed = await Effect.runPromise(Effect.result(prepareApplicationSchemaSource({ tables: {
      users: { kind: "table", validator: { type: "unknown" }, indexes: [] },
    } })));
    expect(Result.isFailure(malformed)).toBe(true);
    const table = defineTable({ tenant: v.string() });
    table.placement = { kind: "partitionBy", field: "tenant" };
    const incompatible = await Effect.runPromise(Effect.result(prepareApplicationSchemaSource(defineSchema({ users: table }))));
    expect(Result.isFailure(incompatible) && incompatible.failure).toMatchObject({ reason: "unsupportedPlacement" });
  });
});
