import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeLogicalSchemaCandidate } from "../src/logical-schema-candidate";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from "../src/logical-storage-requirements";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "../src/relational-schema";

const origin = { kind: "synthetic", sourceId: "neutral.boolean-membership" };
const predicate = (value = true) => ({ kind: "isNullAndBooleanEquals", nullColumnId: "retired",
  booleanColumnId: "selected", value });
const input = (membership: unknown = predicate()) => ({ owner: "medusa", lineageId: "neutral-boolean-membership", capabilities: [],
  tables: [{ tableId: "member", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "parent", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "selected", type: "boolean", nullable: false, default: { kind: "none" }, origin },
    { columnId: "retired", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "member.primary", kind: "primary", columns: ["id"], origin }],
  indexes: [{ indexId: "member.selected-parent", kind: "uniqueBtree", columns: ["parent"], predicate: membership, origin }],
  constraints: [], relationships: [] }],
});
const source = (schema: unknown) => {
  const definition = Result.getOrThrow(normalizeRelationalSchema(schema));
  const candidate = Result.getOrThrow(decodeLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2,
    state: "candidate", deploymentId: "test", scopeId: "scope", applicationAnalysis: { candidateId: "candidate", analysisId: "analysis",
      manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
    sources: [{ key: "medusa.neutral-boolean", owner: "medusa", evidence: {}, sourceSha256: "c".repeat(64),
      writeProfile: "neutral-boolean", definition: { kind: "relational", schema: definition },
      bindings: [{ kind: "definition", localName: "member", table: { namespace: "medusa", logicalName: "neutral-boolean/member" } }] }],
    extensions: [] }));
  const selected = candidate.sources[0];
  if (selected === undefined) throw new Error("Missing neutral source");
  return selected;
};

describe("neutral Boolean partial index predicates", () => {
  it.each([true, false])("retains scoped references and literal %s through cold source reconstruction", value => {
    const original = predicate(value), definition = Result.getOrThrow(normalizeRelationalSchema(input(original)));
    const membership = definition.tables[0]?.indexes[0]?.predicate;
    if (membership?.kind !== "isNullAndBooleanEquals") throw new Error("Missing Boolean predicate");
    expect(membership).toMatchObject({ kind: "isNullAndBooleanEquals", nullColumn: { tableId: "member", columnId: "retired" },
      booleanColumn: { tableId: "member", columnId: "selected" }, value });
    expect(membership.booleanColumn).toMatchObject({ owner: "medusa", lineageId: "neutral-boolean-membership" });
    expect(membership.nullColumn).toMatchObject({ owner: "medusa", lineageId: "neutral-boolean-membership" });
    expect(Object.isFrozen(membership)).toBe(true);
    original.value = !value;
    expect(membership.value).toBe(value);
    const stored: unknown = JSON.parse(JSON.stringify(definition));
    expect(Result.getOrThrow(normalizeRelationalSchema(relationalSchemaSourceFromDefinition(stored)))).toEqual(definition);
    const altered = { ...definition, tables: definition.tables.map(table => ({ ...table,
      indexes: table.indexes.map(index => ({ ...index, predicate: { ...membership, value: !value } })) })) };
    expect(Result.getOrThrow(normalizeRelationalSchema(relationalSchemaSourceFromDefinition(altered)))).not.toEqual(definition);
  });

  it.each([true, false])("derives matching ordered and unique membership for literal %s", value => {
    const current = source(input(predicate(value)));
    const ordered = Result.getOrThrow(compileLogicalSourceIndexes(current)).find(index => index.descriptor === "index/member.selected-parent");
    const unique = Result.getOrThrow(compileLogicalSourceUniqueConstraints(current)).find(index => index.descriptor === "index/member.selected-parent");
    if (ordered === undefined || unique === undefined) throw new Error("Missing complete neutral constraints");
    expect(ordered.physicalSpec.predicate).toEqual({ kind: "fieldIsNullAndBooleanEquals", nullField: "retired", booleanField: "selected", value });
    expect(unique.physicalSpec.predicate).toEqual(ordered.physicalSpec.predicate);
    expect(unique.physicalSpec).toMatchObject({ orderedFields: ["parent"], nullsDistinct: true });
    expect(ordered.physicalSpec.orderedFields).toEqual([{ kind: "documentPath", path: "parent" }, { kind: "systemCreationTime" }]);
  });

  it.each(["true", 1, 0, null, undefined, {}, []])("refuses non-Boolean literal %j", value => {
    expect(Result.isFailure(normalizeRelationalSchema(input({ ...predicate(), value })))).toBe(true);
  });

  it.each([
    { booleanColumnId: "missing" }, { nullColumnId: "missing" }, { booleanColumnId: "parent" },
    { nullColumnId: "selected" }, { kind: "booleanEquals" }, { expression: "selected = true" },
    { booleanColumnId: "" }, { booleanColumnId: "a\0b" },
  ])("refuses malformed or inconsistent predicate %j", change => {
    expect(Result.isFailure(normalizeRelationalSchema(input({ ...predicate(), ...change })))).toBe(true);
  });

  it("requires separate fields and a nullable null scope without forbidding nullable Boolean columns", () => {
    const duplicate = input({ ...predicate(), nullColumnId: "selected" });
    const duplicateColumn = duplicate.tables[0]?.columns.find(column => column.columnId === "selected");
    if (duplicateColumn === undefined) throw new Error("Missing Boolean column");
    duplicateColumn.nullable = true;
    expect(Result.isFailure(normalizeRelationalSchema(duplicate))).toBe(true);
    const nullable = input(), selected = nullable.tables[0]?.columns.find(column => column.columnId === "selected");
    if (selected === undefined) throw new Error("Missing Boolean column");
    selected.nullable = true;
    expect(Result.isSuccess(normalizeRelationalSchema(nullable))).toBe(true);
    const wrongScope = input(), retired = wrongScope.tables[0]?.columns.find(column => column.columnId === "retired");
    if (retired === undefined) throw new Error("Missing null scope");
    retired.nullable = false;
    expect(Result.isFailure(normalizeRelationalSchema(wrongScope))).toBe(true);
  });
});
