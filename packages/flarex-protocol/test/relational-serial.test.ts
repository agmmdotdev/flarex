import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { normalizeRelationalSchema, validateRelationalRowValues } from "../src/relational-schema";

const origin = { kind: "synthetic", sourceId: "neutral.serial-default" };
const input = (type = "integer", nullable = false, value: unknown = { kind: "serialNext" }) => ({
  owner: "medusa", lineageId: "neutral.serial-default", capabilities: [], tables: [{ tableId: "entry", origin,
    columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "ordinal", type, nullable, default: value, origin }],
    keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }],
});
describe("logical generated serial schema default", () => {
  it("captures only a non-null int32 default declaration without generating row values", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(input())), table = schema.tables[0];
    expect(table?.columns[1]?.default).toEqual({ kind: "serialNext" });
    if (table === undefined) throw new Error("Missing neutral serial table");
    expect(Result.isFailure(validateRelationalRowValues(table, { id: "missing" }))).toBe(true);
    for (const ordinal of [-2147483648, 0, 2147483647]) expect(Result.isSuccess(validateRelationalRowValues(table, { id: "present", ordinal }))).toBe(true);
    for (const ordinal of [-2147483649, 2147483648, 1.5, null, "1"]) expect(Result.isFailure(validateRelationalRowValues(table, { id: "invalid", ordinal }))).toBe(true);
  });
  it("refuses nullable, alternate scalar and extra-property declarations", () => {
    expect(Result.isFailure(normalizeRelationalSchema(input("integer", true)))).toBe(true);
    for (const type of ["text", "doublePrecision", "numeric", "jsonb", "boolean", "timestamptz"])
      expect(Result.isFailure(normalizeRelationalSchema(input(type)))).toBe(true);
    for (const value of [{ kind: "serialNext", value: 1 }, { kind: "serialNext", start: 1 }, { kind: "serialNext", extra: true }])
      expect(Result.isFailure(normalizeRelationalSchema(input("integer", false, value)))).toBe(true);
  });
});
