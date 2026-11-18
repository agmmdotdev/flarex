import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, isRelationalColumnValue, validateRelationalRowValues } from "../src/relational-schema";
import { decodeLogicalSchemaCandidate } from "../src/logical-schema-candidate";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from "../src/logical-storage-requirements";

const origin = { kind: "synthetic", sourceId: "neutral.binary64" };
const input = (value: unknown = 1.25, type = "doublePrecision", kind = "doublePrecisionLiteral") => ({
  owner: "medusa", lineageId: "neutral-binary64", capabilities: [], tables: [{ tableId: "measure", origin,
    columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "value", type, nullable: false, default: { kind, value }, origin }],
    keys: [{ keyId: "measure.primary", kind: "primary", columns: ["id"], origin },
      { keyId: "measure.value", kind: "unique", columns: ["value"], origin }], indexes: [], constraints: [], relationships: [] }],
});
const schema = () => Result.getOrThrow(normalizeRelationalSchema(input()));

describe("finite relational binary64", () => {
  it("preserves native finite numbers without broadening the int32 scalar", () => {
    for (const value of [1.25, 2147483648, -2147483649, 9007199254740991, 1e30, Number.MAX_VALUE, Number.MIN_VALUE]) {
      expect(isRelationalColumnValue("doublePrecision", false, value)).toBe(true);
      expect(Result.isSuccess(normalizeRelationalSchema(input(value)))).toBe(true);
      expect(isRelationalColumnValue("integer", false, value)).toBe(false);
    }
    for (const value of [NaN, Infinity, -Infinity, "1.25", true, null])
      expect(isRelationalColumnValue("doublePrecision", false, value)).toBe(false);
    expect(isRelationalColumnValue("doublePrecision", true, null)).toBe(true);
    for (const value of [-2147483648, 0, 2147483647]) expect(isRelationalColumnValue("integer", false, value)).toBe(true);
  });

  it("authenticates the finite default vocabulary and one stored zero", () => {
    const zero = Result.getOrThrow(normalizeRelationalSchema(input(-0))).tables[0]?.columns[1]?.default;
    expect(zero).toEqual({ kind: "doublePrecisionLiteral", value: 0 });
    if (zero?.kind !== "doublePrecisionLiteral") throw new Error("Missing binary64 default");
    expect(Object.is(zero.value, -0)).toBe(false);
    for (const value of [NaN, Infinity, -Infinity, "1.25", null])
      expect(Result.isFailure(normalizeRelationalSchema(input(value)))).toBe(true);
    expect(Result.isFailure(normalizeRelationalSchema(input(1.25, "integer")))).toBe(true);
    expect(Result.isFailure(normalizeRelationalSchema(input(1, "doublePrecision", "integerLiteral")))).toBe(true);
    const table = schema().tables[0]; if (table === undefined) throw new Error("Missing measure table");
    expect(Result.isSuccess(validateRelationalRowValues(table, { id: "zero", value: 0 }))).toBe(true);
    expect(Result.isFailure(validateRelationalRowValues(table, { id: "zero", value: -0 }))).toBe(true);
  });

  it("uses existing binary64 ordered and unique key contracts", () => {
    const definition = schema();
    const candidate = Result.getOrThrow(decodeLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2,
      state: "candidate", deploymentId: "test", scopeId: "scope", applicationAnalysis: { candidateId: "candidate", analysisId: "analysis",
        manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) }, sources: [{ key: "medusa.neutral-binary64", owner: "medusa",
        evidence: {}, sourceSha256: "c".repeat(64), writeProfile: "neutral-binary64", definition: { kind: "relational", schema: definition },
        bindings: [{ kind: "definition", localName: "measure", table: { namespace: "medusa", logicalName: "neutral-binary64/measure" } }] }], extensions: [] }));
    const source = candidate.sources[0]; if (source === undefined) throw new Error("Missing binary64 source");
    expect(Result.getOrThrow(compileLogicalSourceIndexes(source)).find(index => index.descriptor === "key/measure.value")?.physicalSpec.orderedFields)
      .toEqual([{ kind: "documentPath", path: "value" }, { kind: "systemCreationTime" }]);
    expect(Result.getOrThrow(compileLogicalSourceUniqueConstraints(source)).find(index => index.descriptor === "key/measure.value")?.physicalSpec)
      .toMatchObject({ orderedFields: ["value"] });
  });
});
