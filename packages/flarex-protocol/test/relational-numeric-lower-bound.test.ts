import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition, validateRelationalRowValues } from "../src/relational-schema";

const origin = { kind: "synthetic", sourceId: "neutral.numeric-bound" };
export const numericBoundInput = (minimum = "0") => ({ owner: "system", lineageId: "neutral-numeric-bound", capabilities: [], tables: [{
  tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [], relationships: [],
  constraints: [{ constraintId: "entry.amount", kind: "numericLowerBound", columnId: "amount", minimum, origin }],
}] });
const table = (minimum = "0") => Result.getOrThrow(normalizeRelationalSchema(numericBoundInput(minimum))).tables[0]!;

describe("neutral exact numeric lower bound", () => {
  it.each([null, 0, -0, "0", "-0", "0.000", "1e-10000", "9007199254740993.000000000000000001"])("admits SQL-null or nonnegative %s", amount => {
    expect(Result.isSuccess(validateRelationalRowValues(table(), { id: "row", amount }))).toBe(true);
  });
  it.each([-1, "-1e-10000", "-0.00000000000000000000000001"])("refuses exact negative %s", amount => {
    expect(validateRelationalRowValues(table(), { id: "row", amount })).toMatchObject({ _tag: "Failure", failure: { reason: "constraintViolation", column: "amount" } });
  });
  it("preserves distinctions beyond binary64 for either sign", () => {
    for (const minimum of ["9007199254740993.000000000000000001", "-9007199254740993.000000000000000001"]) {
      expect(Result.isSuccess(validateRelationalRowValues(table(minimum), { id: "same", amount: minimum }))).toBe(true);
    }
    expect(Result.isFailure(validateRelationalRowValues(table("1.000000000000000001"), { id: "below", amount: "1.0000000000000000009" }))).toBe(true);
    expect(Result.isFailure(validateRelationalRowValues(table("-1.000000000000000001"), { id: "below", amount: "-1.0000000000000000011" }))).toBe(true);
  });
  it("round trips stored definitions without changing older schemas", () => {
    const normalized = Result.getOrThrow(normalizeRelationalSchema(numericBoundInput("1.25")));
    expect(Result.getOrThrow(normalizeRelationalSchema(relationalSchemaSourceFromDefinition(JSON.parse(JSON.stringify(normalized)))))).toEqual(normalized);
    const old = numericBoundInput(); old.tables[0]!.constraints = [];
    const historical = Result.getOrThrow(normalizeRelationalSchema(old));
    expect(Result.getOrThrow(normalizeRelationalSchema(relationalSchemaSourceFromDefinition(historical)))).toEqual(historical);
  });
  it.each(["-0", "00", "0.0", "1e0", "NaN", "0\n", "1; SELECT 1", "1".repeat(513)])("refuses malformed or noncanonical minimum %s", minimum => {
    expect(Result.isFailure(normalizeRelationalSchema(numericBoundInput(minimum)))).toBe(true);
  });
  it("requires a numeric column and consistent default", () => {
    const wrong = numericBoundInput(); wrong.tables[0]!.columns[1]!.type = "text";
    expect(Result.isFailure(normalizeRelationalSchema(wrong))).toBe(true);
    const negative = numericBoundInput(); Object.assign(negative.tables[0]!.columns[1]!, { default: { kind: "exactNumericLiteral", value: "-0.01" } });
    expect(Result.isFailure(normalizeRelationalSchema(negative))).toBe(true);
    const extra = numericBoundInput(); Object.assign(extra.tables[0]!.constraints[0]!, { maximum: "1" });
    expect(Result.isFailure(normalizeRelationalSchema(extra))).toBe(true);
  });
});
