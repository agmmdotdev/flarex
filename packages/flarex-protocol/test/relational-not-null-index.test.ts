import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "../src/relational-schema";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from "../src/logical-storage-requirements";
import { AppOrderedIndexPhysicalSpecV1Schema } from "../src/ordered-index";
import { canonicalizeAppIndexPhysicalSpecV1 } from "../src/index-definition";

const origin = { kind: "synthetic", sourceId: "neutral.not-null-membership" };
const single = { kind: "isNotNull", columnId: "retired" };
const mixed = { kind: "isNullAndNotNull", nullColumnId: "retired", notNullColumnId: "parent" };
const input = (predicate: unknown, kind = "btree") => ({ owner: "system", lineageId: "neutral-not-null", capabilities: [],
  tables: [{ tableId: "member", origin,
    columns: ["id", "key", "parent", "retired"].map(columnId => ({ columnId, type: "text",
      nullable: columnId === "parent" || columnId === "retired", default: { kind: "none" }, origin })),
    keys: [{ keyId: "member.primary", kind: "primary", columns: ["id"], origin }],
    indexes: [{ indexId: "member.partial", kind, columns: ["key"], predicate, origin }], constraints: [], relationships: [],
  }],
});
const source = (predicate: unknown, kind = "btree") => ({ key: "system.neutral-not-null", owner: "system" as const,
  evidence: null, sourceSha256: "a".repeat(64), writeProfile: "neutral-not-null", bindings: [],
  definition: { kind: "relational" as const, schema: Result.getOrThrow(normalizeRelationalSchema(input(predicate, kind))) },
});

describe("neutral not-null ordered membership", () => {
  it.each([single, mixed])("preserves scoped immutable predicates through cold reconstruction: $kind", predicate => {
    const definition = Result.getOrThrow(normalizeRelationalSchema(input(predicate)));
    const retained = definition.tables[0]?.indexes[0]?.predicate;
    expect(retained).toMatchObject({ kind: predicate.kind });
    expect(Object.isFrozen(retained)).toBe(true);
    if (retained?.kind === "isNotNull") expect(retained.column).toEqual({
      owner: "system", lineageId: "neutral-not-null", tableId: "member", columnId: "retired",
    });
    else if (retained?.kind === "isNullAndNotNull") expect(retained).toMatchObject({
      nullColumn: { columnId: "retired" }, notNullColumn: { columnId: "parent" },
    });
    else throw new Error("Missing native not-null predicate");
    expect(Result.getOrThrow(normalizeRelationalSchema(relationalSchemaSourceFromDefinition(
      JSON.parse(JSON.stringify(definition)),
    )))).toEqual(definition);
  });

  it.each([
    { source: single, physical: { kind: "fieldIsNotNull", field: "retired" },
      canonical: '"predicate":{"field":"retired","kind":"fieldIsNotNull"}' },
    { source: mixed, physical: { kind: "fieldIsNullAndNotNull", nullField: "retired", notNullField: "parent" },
      canonical: '"predicate":{"kind":"fieldIsNullAndNotNull","notNullField":"parent","nullField":"retired"}' },
  ])("derives canonical ordered definitions and refuses unique admission: $source.kind", async contract => {
    const selected = source(contract.source);
    const index = Result.getOrThrow(compileLogicalSourceIndexes(selected)).find(member => member.descriptor === "index/member.partial");
    if (index === undefined) throw new Error("Missing partial ordered index");
    expect(index.physicalSpec.predicate).toEqual(contract.physical);
    const canonical = await canonicalizeAppIndexPhysicalSpecV1(index.physicalSpec);
    expect(canonical.canonicalText).toContain(contract.canonical);
    expect(await canonicalizeAppIndexPhysicalSpecV1(JSON.parse(JSON.stringify(index.physicalSpec)))).toEqual(canonical);
    expect(Result.isFailure(compileLogicalSourceUniqueConstraints(source(contract.source, "uniqueBtree")))).toBe(true);
  });

  it.each([
    { ...single, columnId: "missing" }, { ...single, columnId: "" }, { ...single, extra: true },
    { ...mixed, nullColumnId: "missing" }, { ...mixed, notNullColumnId: "missing" },
    { ...mixed, notNullColumnId: "retired" }, { ...mixed, nullColumnId: "key" },
    { ...mixed, nullColumnId: "" }, { ...mixed, extra: true },
  ])("refuses malformed, missing or contradictory references: %j", predicate => {
    expect(Result.isFailure(normalizeRelationalSchema(input(predicate)))).toBe(true);
  });

  it("does not expose tautological non-null predicates as generated values", () => {
    const selected = source({ ...single, columnId: "id" });
    expect(Result.isSuccess(compileLogicalSourceIndexes(selected))).toBe(true);
    expect(selected.definition.schema.capabilities).toEqual([]);
  });

  it("requires distinct physical fields and strict membership keys", () => {
    const index = Result.getOrThrow(compileLogicalSourceIndexes(source(mixed)))
      .find(member => member.descriptor === "index/member.partial");
    if (index === undefined) throw new Error("Missing partial ordered index");
    const decode = Schema.decodeUnknownResult(AppOrderedIndexPhysicalSpecV1Schema, { onExcessProperty: "error" });
    for (const predicate of [
      { kind: "fieldIsNullAndNotNull", nullField: "retired", notNullField: "retired" },
      { kind: "fieldIsNullAndNotNull", nullField: "retired" },
      { kind: "fieldIsNotNull", field: "" },
      { kind: "fieldIsNotNull", field: "parent", extra: true },
    ]) expect(Result.isFailure(decode({ ...index.physicalSpec, predicate }))).toBe(true);
  });
});
