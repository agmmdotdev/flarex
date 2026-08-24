import { describe, expect, it } from "vitest";

import {
  applicationSchemaDefinition,
  applicationTableDefinition,
  applicationTableDefinitionWithIndex,
  snapshotApplicationSchemaDefinition,
} from "../src/ApplicationSchema";
import { applicationObjectValidatorJson } from "../src/ValidatorJson";

describe("application table and index authoring", () => {
  it("owns, validates, freezes, and deterministically orders a logical schema", () => {
    const fields = ["status"] as [string];
    const orders = applicationTableDefinitionWithIndex(
      applicationTableDefinition(applicationObjectValidatorJson({
        status: {
          fieldType: { type: "string" },
          optional: false,
        },
      })),
      "by_status",
      fields,
    );
    fields[0] = "changed";

    const schema = applicationSchemaDefinition({
      users: applicationTableDefinition(applicationObjectValidatorJson({})),
      orders,
    });

    expect(schema.tables.map(table => table.logicalName)).toEqual([
      "orders",
      "users",
    ]);
    expect(schema.indexes).toEqual([{
      tableLogicalName: "orders",
      descriptor: "by_status",
      fields: ["status"],
    }]);
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.tables)).toBe(true);
    expect(Object.isFrozen(schema.tables[0]?.definition.documentType)).toBe(true);
    expect(Object.isFrozen(schema.indexes[0]?.fields)).toBe(true);
  });

  it("returns a new table definition when an index is added", () => {
    const table = applicationTableDefinition(applicationObjectValidatorJson({}));
    const indexed = applicationTableDefinitionWithIndex(
      table,
      "by_name",
      ["name"],
    );

    expect(table.indexes).toEqual([]);
    expect(indexed.indexes).toEqual([{
      descriptor: "by_name",
      fields: ["name"],
    }]);
    expect(indexed).not.toBe(table);
  });

  it.each([
    ["reserved descriptor", "_reserved", ["name"]],
    ["empty field list", "by_name", []],
    ["reserved field", "by_name", ["_id"]],
    ["duplicate field", "by_name", ["name", "name"]],
  ] as const)("rejects an invalid %s", (_case, descriptor, fields) => {
    const table = applicationTableDefinition(applicationObjectValidatorJson({}));

    expect(() => applicationTableDefinitionWithIndex(
      table,
      descriptor,
      fields as unknown as readonly [string, ...ReadonlyArray<string>],
    )).toThrow();
  });

  it("rejects duplicate descriptors and duplicate ordered field lists", () => {
    const table = applicationTableDefinition(applicationObjectValidatorJson({}));
    const byName = applicationTableDefinitionWithIndex(
      table,
      "by_name",
      ["name"],
    );

    expect(() => applicationTableDefinitionWithIndex(
      byName,
      "by_name",
      ["email"],
    )).toThrow();
    expect(() => applicationTableDefinitionWithIndex(
      byName,
      "by_email",
      ["name"],
    )).toThrow();
  });

  it("rejects an exact index declaration whose table is absent", () => {
    expect(() => snapshotApplicationSchemaDefinition({
      tables: [],
      indexes: [{
        tableLogicalName: "missing",
        descriptor: "by_name",
        fields: ["name"],
      }],
    })).toThrow(RangeError);
  });
});
