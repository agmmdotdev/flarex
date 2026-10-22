import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition, validateRelationalRowValues } from "../src/relational-schema";

const origin = { kind: "synthetic", sourceId: "neutral.real-input" };
const input = (type = "real", defaultValue: unknown = { kind: "none" }) => ({ owner: "system", lineageId: "neutral-real", capabilities: [],
  tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "amount", type, nullable: true, default: defaultValue, origin },
  ], keys: [{ keyId: "primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }] });
const schema = () => Result.getOrThrow(normalizeRelationalSchema(input()));
const table = () => { const value = schema().tables[0]; if (value === undefined) throw new Error("Missing REAL table"); return value; };

describe("SQL REAL input contract", () => {
  it.each([null, 0, -0, 0.1, 1.0000000596046448, 3.4028235e38, 1e-45, 1e-46, 1e39])
    ("checks finite input %s without claiming a canonical SQL conversion", amount => {
      expect(Result.isSuccess(validateRelationalRowValues(table(), { id: "row", amount }))).toBe(true);
    });
  it.each(["0.1", true, {}, [], Infinity, -Infinity, NaN])("refuses nonfinite or nonnumeric input %s", amount => {
    expect(validateRelationalRowValues(table(), { id: "row", amount })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidValue", column: "amount" } });
  });
  it("round-trips the distinct source vocabulary without changing column identity", () => {
    const original = schema(), reconstructed = Result.getOrThrow(normalizeRelationalSchema(relationalSchemaSourceFromDefinition(original)));
    expect(reconstructed).toEqual(original);
    expect(original.tables[0]?.columns.find(column => column.identity.columnId === "amount")?.type).toBe("real");
    const binary64 = Result.getOrThrow(normalizeRelationalSchema(input("doublePrecision")));
    expect(binary64.tables[0]?.columns[0]?.identity).toEqual(original.tables[0]?.columns[0]?.identity);
    expect(binary64).not.toEqual(original);
  });
  it.each([{ kind: "doublePrecisionLiteral", value: 0.1 }, { kind: "integerLiteral", value: 1 },
    { kind: "realLiteral", value: 0.1 }])("refuses undeclared literal default %j", value => {
    expect(Result.isFailure(normalizeRelationalSchema(input("real", value)))).toBe(true);
  });
});
