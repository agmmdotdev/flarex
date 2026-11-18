import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, relationalReverseIndexes, relationalHasIndexedScalarPrefix } from "../src/relational-schema";
import { decodeLogicalSchemaCandidate } from "../src/logical-schema-candidate";
import { compileLogicalSourceIndexes } from "../src/logical-storage-requirements";

const origin = { kind: "synthetic", sourceId: "neutral-composite-reverse" };
function schema(options: { readonly indexes?: readonly unknown[]; readonly foreignKey?: boolean; readonly extraKeys?: readonly unknown[] } = {}) {
  return Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-composite-reverse", capabilities: [], tables: [
    { tableId: "targets", origin, columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin }],
      keys: [{ keyId: "target-primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] },
    { tableId: "pairs", origin, columns: ["left_id", "right_id", "extra_id", "deleted_at"].map(columnId => ({
      columnId, type: "text", nullable: columnId === "deleted_at", default: { kind: "none" }, origin,
    })), keys: [{ keyId: "pair-primary", kind: "primary", columns: ["left_id", "right_id"], origin }, ...options.extraKeys ?? []],
      indexes: options.indexes ?? [{ indexId: "active-right", kind: "btree", columns: ["right_id"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin }],
      constraints: options.foreignKey ? [{ constraintId: "right-target", kind: "foreignKey", sourceColumns: ["right_id"],
        targetColumns: [{ tableId: "targets", columnId: "id" }], onDelete: "restrict", onUpdate: "noAction", origin }] : [], relationships: [] },
  ] }));
}
function table(options: Parameters<typeof schema>[0] = {}) {
  const selected = schema(options).tables.find(table => table.identity.tableId === "pairs");
  if (selected === undefined) throw new Error("Missing composite pair fixture");
  return selected;
}
const ids = (selected: ReturnType<typeof table>) => relationalReverseIndexes(selected).map(index => ({ field: index.column.columnId, descriptor: index.descriptor }));

describe("derived native relational reverse access", () => {
  it("derives an unconditional text path for a composite suffix without changing the native partial index", () => {
    const selected = table(), native = JSON.stringify(selected);
    expect(ids(selected)).toEqual([{ field: "right_id", descriptor: "key-reverse/right_id" }]);
    expect(relationalHasIndexedScalarPrefix(selected, "left_id")).toBe(true);
    expect(relationalHasIndexedScalarPrefix(selected, "right_id")).toBe(true);
    expect(relationalHasIndexedScalarPrefix(selected, "extra_id")).toBe(false);
    expect(JSON.stringify(selected)).toBe(native);
    expect(selected.constraints).toEqual([]);
    expect(selected.indexes[0]?.predicate?.kind).toBe("isNull");
  });

  it("preserves old FK descriptor precedence and deduplicates overlapping suffix requirements", () => {
    expect(ids(table({ foreignKey: true }))).toEqual([{ field: "right_id", descriptor: "fk-reverse/right_id" }]);
    expect(ids(table({ extraKeys: [{ keyId: "pair-extra", kind: "unique", columns: ["left_id", "right_id", "extra_id"], origin }] })))
      .toEqual([{ field: "right_id", descriptor: "key-reverse/right_id" }, { field: "extra_id", descriptor: "key-reverse/extra_id" }]);
  });

  it("reuses existing unconditional indexed prefixes and does not reinterpret conditional coverage", () => {
    const declared = { indexId: "right-complete", kind: "btree", columns: ["right_id"], predicate: null, origin };
    expect(ids(table({ indexes: [declared] }))).toEqual([]);
    expect(ids(table({ foreignKey: true, indexes: [declared] }))).toEqual([]);
    const reversedKey = { keyId: "right-leading", kind: "unique", columns: ["right_id", "left_id"], origin };
    expect(ids(table({ extraKeys: [reversedKey] }))).toEqual([]);
    expect(ids(table())).toHaveLength(1);
  });

  it("compiles the new requirement beside unchanged native artifacts and retains FK artifact names", () => {
    const requirements = (foreignKey: boolean) => {
      const definition = schema({ foreignKey });
      const candidate = Result.getOrThrow(decodeLogicalSchemaCandidate({
        kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate", deploymentId: "test", scopeId: "scope",
        applicationAnalysis: { candidateId: "candidate", analysisId: "analysis", manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
        sources: [{ key: "medusa.neutral-reverse", owner: "medusa", evidence: {}, sourceSha256: "c".repeat(64), writeProfile: "medusa.neutral-reverse",
          definition: { kind: "relational", schema: definition },
          bindings: definition.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
            table: { namespace: "medusa", logicalName: table.identity.tableId } })) }], extensions: [],
      }));
      const source = candidate.sources[0];
      if (source === undefined) throw new Error("Missing authenticated source");
      return Result.getOrThrow(compileLogicalSourceIndexes(source)).filter(requirement => requirement.localName === "pairs");
    };
    const native = requirements(false), foreignKey = requirements(true);
    const reverse = native.find(requirement => requirement.descriptor === "key-reverse/right_id");
    expect(reverse?.physicalSpec.orderedFields).toEqual([{ kind: "documentPath", path: "right_id" }, { kind: "systemCreationTime" }]);
    expect(reverse?.physicalSpec.predicate).toBeUndefined();
    expect(foreignKey.find(requirement => requirement.descriptor === "fk-reverse/right_id")?.physicalSpec).toEqual(reverse?.physicalSpec);
    expect(foreignKey.some(requirement => requirement.descriptor === "key-reverse/right_id")).toBe(false);
    expect(native.filter(requirement => !requirement.descriptor.startsWith("key-reverse/")))
      .toEqual(foreignKey.filter(requirement => !requirement.descriptor.startsWith("fk-reverse/")));
  });
});
