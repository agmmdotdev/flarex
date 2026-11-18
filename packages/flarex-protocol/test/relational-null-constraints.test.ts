import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition, validateRelationalRowValues } from "../src/relational-schema";
import { decodeLogicalSchemaCandidate } from "../src/logical-schema-candidate";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from "../src/logical-storage-requirements";
import { AppIndexAllNullPredicateV1Schema } from "../src/ordered-index";
import { canonicalizeAppIndexPhysicalSpecV1 } from "../src/index-definition";
import { canonicalizeAppUniqueConstraintPhysicalSpecV1, LogicalDocumentUniqueConstraintDeclarationSchema } from "../src/app-unique-constraint-definition";

const origin = { kind: "synthetic", sourceId: "neutral.null-contract" };
const input = () => ({ owner: "system", lineageId: "neutral-null-contract", capabilities: [], tables: [{
  tableId: "entry", origin,
  columns: ["id", "key", "parent", "provider", "province", "retired"].map(columnId => ({
    columnId, type: "text", nullable: columnId !== "id" && columnId !== "key", default: { kind: "none" }, origin,
  })),
  keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }],
  indexes: [{ indexId: "entry.root-key", kind: "uniqueBtree", columns: ["key"],
    predicate: { kind: "allNull", columnIds: ["retired", "province"] }, origin }],
  constraints: [
    { constraintId: "entry.provider", kind: "nullImplication", nonNullColumnId: "parent", requiredColumnId: "provider", required: "null", origin },
    { constraintId: "entry.province", kind: "nullImplication", nonNullColumnId: "parent", requiredColumnId: "province", required: "notNull", origin },
  ], relationships: [],
}] });
const schema = () => Result.getOrThrow(normalizeRelationalSchema(input()));
const table = () => {
  const selected = schema().tables[0];
  if (selected === undefined) throw new Error("Missing neutral table");
  return selected;
};

describe("neutral null implication and conjunction", () => {
  for (const parent of [null, "parent"]) for (const provider of [null, "provider"]) for (const province of [null, "province"])
    it.each([null, "deleted"])(`checks parent=${parent}, provider=${provider}, province=${province}, retired=%s`, retired => {
      const result = validateRelationalRowValues(table(), { id: "row", key: "key", parent, provider, province, retired });
      expect(Result.isSuccess(result)).toBe(parent === null || provider === null && province !== null);
      if (Result.isFailure(result)) expect(result.failure).toMatchObject({ reason: "constraintViolation" });
    });

  it("keeps column contracts before cross-column checks", () => {
    expect(validateRelationalRowValues(table(), { id: "row", key: "key", parent: "parent", provider: "provider", retired: null }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "missingColumn", column: "province" } });
    expect(validateRelationalRowValues(table(), { id: "row", key: "key", parent: false, provider: null, province: "province", retired: null }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidValue", column: "parent" } });
  });

  it("retains identities and a sorted immutable pair through source reconstruction", () => {
    const original = input(), normalized = Result.getOrThrow(normalizeRelationalSchema(original));
    const predicate = normalized.tables[0]?.indexes[0]?.predicate;
    expect(predicate).toEqual({ kind: "allNull", columns: ["province", "retired"].map(columnId => ({
      owner: "system", lineageId: "neutral-null-contract", tableId: "entry", columnId,
    })) });
    expect(Object.isFrozen(predicate)).toBe(true);
    if (predicate?.kind !== "allNull") throw new Error("Missing conjunction");
    expect(Object.isFrozen(predicate.columns)).toBe(true);
    original.tables[0]!.indexes[0]!.predicate.columnIds.reverse();
    expect(Result.getOrThrow(normalizeRelationalSchema(original))).toEqual(normalized);
    expect(Result.getOrThrow(normalizeRelationalSchema(relationalSchemaSourceFromDefinition(JSON.parse(JSON.stringify(normalized)))))).toEqual(normalized);
  });

  it.each([
    { nonNullColumnId: "missing" }, { requiredColumnId: "missing" }, { requiredColumnId: "parent" },
    { required: true }, { required: "NULL" }, { expression: "parent IS NULL" },
  ])("refuses malformed null implication %j", change => {
    const candidate = input(), constraint = candidate.tables[0]!.constraints[0]!;
    Object.assign(constraint, change);
    expect(Result.isFailure(normalizeRelationalSchema(candidate))).toBe(true);
  });

  it.each([[], ["retired"], ["retired", "retired"], ["retired", "missing"], ["retired", "province", "parent"], ["id", "retired"]]
    .map(columnIds => ({ columnIds })))
    ("refuses malformed or non-nullable conjunction $columnIds", ({ columnIds }) => {
      const candidate = input();
      candidate.tables[0]!.indexes[0]!.predicate.columnIds = columnIds;
      expect(Result.isFailure(normalizeRelationalSchema(candidate))).toBe(true);
    });

  it("derives identical ordered and unique membership without extending document declarations", async () => {
    const candidate = Result.getOrThrow(decodeLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2,
      state: "candidate", deploymentId: "test", scopeId: "scope", applicationAnalysis: { candidateId: "candidate", analysisId: "analysis",
        manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
      sources: [{ key: "system.neutral-null", owner: "system", evidence: {}, sourceSha256: "c".repeat(64), writeProfile: "neutral-null",
        definition: { kind: "relational", schema: schema() },
        bindings: [{ kind: "definition", localName: "entry", table: { namespace: "system", logicalName: "neutral-null/entry" } }] }], extensions: [] }));
    const source = candidate.sources[0];
    if (source === undefined) throw new Error("Missing neutral source");
    const ordered = Result.getOrThrow(compileLogicalSourceIndexes(source)).find(index => index.descriptor === "index/entry.root-key");
    const unique = Result.getOrThrow(compileLogicalSourceUniqueConstraints(source)).find(index => index.descriptor === "index/entry.root-key");
    const predicate = { kind: "fieldsAreNull", fields: ["province", "retired"] };
    expect(ordered?.physicalSpec.predicate).toEqual(predicate);
    expect(unique?.physicalSpec.predicate).toEqual(predicate);
    if (ordered === undefined || unique === undefined) throw new Error("Missing conjunction definitions");
    const orderedCanonical = await canonicalizeAppIndexPhysicalSpecV1({ ...ordered.physicalSpec, predicate });
    const uniqueCanonical = await canonicalizeAppUniqueConstraintPhysicalSpecV1({ ...unique.physicalSpec, predicate });
    predicate.fields.reverse();
    expect(orderedCanonical.physicalSpec.predicate).toEqual({ kind: "fieldsAreNull", fields: ["province", "retired"] });
    expect(uniqueCanonical.physicalSpec.predicate).toEqual({ kind: "fieldsAreNull", fields: ["province", "retired"] });
    if (uniqueCanonical.physicalSpec.predicate?.kind !== "fieldsAreNull") throw new Error("Missing canonical conjunction");
    expect(Object.isFrozen(uniqueCanonical.physicalSpec.predicate.fields)).toBe(true);
    for (const canonical of [orderedCanonical, uniqueCanonical])
      expect(canonical.canonicalText).toContain('"predicate":{"fields":["province","retired"],"kind":"fieldsAreNull"}');
    expect(await canonicalizeAppIndexPhysicalSpecV1(orderedCanonical.physicalSpec)).toEqual(orderedCanonical);
    expect(await canonicalizeAppUniqueConstraintPhysicalSpecV1(uniqueCanonical.physicalSpec)).toEqual(uniqueCanonical);
    expect(Schema.is(LogicalDocumentUniqueConstraintDeclarationSchema)({ tableLogicalName: "entry", descriptor: "root-key",
      fields: ["key"], sparse: false, nullsDistinct: true, predicate })).toBe(false);
  });

  it.each([["b", "a"], ["a", "a"], ["a"], ["a", "b", "c"], ["a", null]].map(fields => ({ fields })))
    ("refuses noncanonical physical pair $fields", ({ fields }) => {
      expect(Schema.is(AppIndexAllNullPredicateV1Schema)({ kind: "fieldsAreNull", fields })).toBe(false);
    });
});
