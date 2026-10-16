import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { lowerDmlSchema } from "../src/schema/lower";
import type { SchemaTable } from "../src/schema/model";

const table: SchemaTable = { name: "measure", columns: [
  { name: "id", type: "id", nullable: false, primaryKey: true },
  ...["weight", "rank", "quantity"].map(name => ({ name, type: "number" as const, nullable: false, primaryKey: false, defaultValue: 1.25 })),
  { name: "created_at", type: "dateTime", nullable: false, primaryKey: false },
  { name: "updated_at", type: "dateTime", nullable: false, primaryKey: false },
  { name: "deleted_at", type: "dateTime", nullable: true, primaryKey: false },
], indexes: [], foreignKeys: [] };
describe("native DML number lowering", () => {
  it("lowers every native number by scalar semantics rather than module or field name", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema([table], "neutral-number")));
    expect(schema.tables[0]?.columns.filter(column => ["weight", "rank", "quantity"].includes(column.identity.columnId)))
      .toMatchObject(["quantity", "rank", "weight"].map(columnId => ({ identity: { columnId }, type: "doublePrecision", default: { kind: "doublePrecisionLiteral", value: 1.25 } })));
  });
  it("refuses nonfinite native defaults through the shared schema contract", () => {
    for (const value of [NaN, Infinity, -Infinity])
      expect(Result.isFailure(normalizeRelationalSchema(lowerDmlSchema([{ ...table, columns: table.columns.map(column =>
        column.type === "number" ? { ...column, defaultValue: value } : column) }], "neutral-number")))).toBe(true);
  });
});
