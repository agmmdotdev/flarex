import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { coreNativeRelationalRows, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { prepareCoreNativeRelationalRead } from "../../src/core/nativeRelationalQuery";
import { coreNativeIndexName } from "../../src/core/schemaTableName";
import { compileNativeDeclaredEqualityDefinition } from "./nativeDeclaredEqualityIndexScenario";

const origin = { kind: "synthetic", sourceId: "neutral-native-declared-equality-schema" } as const;
const target = { scopeUuid: "8a400000-0000-4000-8000-000000000003", epochUuid: "8a400000-0000-4000-8000-000000000004" };
type Coverage = "later-btree" | "compound-prefix" | "foreign-key" | "foreign-key-alias" | "foreign-key-collision" | "reverse-collision";
const compile = Effect.fn("NativeDeclaredEqualitySchema.compile")(function* (coverage: Coverage) {
  const foreign = coverage === "foreign-key" || coverage === "foreign-key-alias" || coverage === "foreign-key-collision";
  const reverse = coverage === "reverse-collision";
  const nativeId = coverage === "later-btree" ? "record.aaa-equality"
    : coverage === "foreign-key-alias" || coverage === "foreign-key-collision" ? "foreign-key/record.lookup"
    : reverse ? "key-reverse/right" : "record.lookup-equality";
  const field = coverage === "foreign-key-collision" || reverse ? "note" : "lookup";
  const relational = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: [
      ...(foreign ? [{ tableId: "endpoint", origin, columns: [{ columnId: "id", type: "text", nullable: false,
        default: { kind: "none" }, origin }], keys: [{ keyId: "endpoint.primary", kind: "primary", columns: ["id"], origin }],
        indexes: [], constraints: [], relationships: [] }] : []),
      { tableId: "record", origin, columns: [
        ...["id", "note", "left", "right"].map(columnId => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
        { columnId: "lookup", type: "text", nullable: true, default: { kind: "none" }, origin },
        { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
      ], keys: [{ keyId: "record.primary", kind: "primary", columns: reverse ? ["left", "right"] : ["id"], origin }],
      indexes: [
        // The equality declaration intentionally precedes the old ordered path.
        { indexId: nativeId, kind: "textEquality", columns: [field], predicate: null, origin },
        { indexId: "record.active-lookup", kind: "btree", columns: ["lookup"],
          predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
        ...(coverage === "later-btree" || coverage === "compound-prefix" ? [{ indexId: "record.existing-lookup", kind: "btree",
          columns: coverage === "compound-prefix" ? ["lookup", "note"] : ["lookup"], predicate: null, origin }] : []),
      ], constraints: foreign ? [{ constraintId: "record.lookup", kind: "foreignKey", sourceColumns: ["lookup"],
        targetColumns: [{ tableId: "endpoint", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin }] : [],
      relationships: [] },
    ], capabilities: [] }));
  if (coverage === "later-btree") expect(relational.tables[0]?.indexes.map(index => index.identity.indexId)).toEqual([
    "record.aaa-equality", "record.active-lookup", "record.existing-lookup",
  ]);
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-declared-equality-schema", owner: "medusa",
    writeProfile: "medusa.neutral-declared-equality-schema", evidence: { provenance: origin },
    definition: { kind: "relational", schema: relational }, bindings: relational.tables.map(table => ({ kind: "definition",
      localName: table.identity.tableId, table: { namespace: "medusa", logicalName: `${origin.sourceId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
});

describe("declared native equality schema lowering", () => {
  it("retains the declaration as nonunique unconditional nullable scalar access", async () => {
    const definition = await Effect.runPromise(compileNativeDeclaredEqualityDefinition()), table = definition.tables[0];
    if (table?.table === undefined) throw new Error("Missing neutral equality table");
    const indexName = await Effect.runPromise(coreNativeIndexName(table.table, "index", "record.lookup-equality"));
    expect(table.indexes?.map(index => index.nativeId)).toEqual([
      "record.primary", "record.active", "record.active-lookup", "record.lookup-equality",
    ]);
    expect(table.indexes?.find(index => index.nativeId === "record.lookup-equality"))
      .toEqual({ nativeId: "record.lookup-equality", kind: "index", indexName, fields: ["lookup"] });
    expect(table.uniqueConstraints.map(constraint => constraint.descriptor)).toEqual(["record.primary"]);
    expect(definition.foreignKeys).toBeUndefined();
    expect(definition.privateTables).toBeUndefined();
    expect(definition.schema.tables[0]?.documentType).toMatchObject({ type: "object", value: {
      lookup: { optional: false, fieldType: { type: "union", value: [{ type: "string" }, { type: "null" }] } },
    } });
  });

  it("aliases a later existing B-tree without renaming or reordering the old paths", async () => {
    const definition = await Effect.runPromise(compile("later-btree")), table = definition.tables[0];
    if (table?.table === undefined) throw new Error("Missing alias table");
    const physical = await Effect.runPromise(coreNativeIndexName(table.table, "index", "record.existing-lookup"));
    expect(table.indexes?.map(index => index.nativeId)).toEqual([
      "record.primary", "record.active-lookup", "record.existing-lookup", "record.aaa-equality",
    ]);
    expect(table.indexes?.find(index => index.nativeId === "record.aaa-equality"))
      .toEqual({ nativeId: "record.aaa-equality", kind: "index", indexName: physical, fields: ["lookup"] });
    expect(definition.schema.tables[0]?.indexes.filter(index => index.indexDescriptor === physical)).toHaveLength(1);
  });

  it("does not alias a compound leading prefix as the declared one-field index", async () => {
    const definition = await Effect.runPromise(compile("compound-prefix")), table = definition.tables[0];
    const existing = table?.indexes?.find(index => index.nativeId === "record.existing-lookup");
    const equality = table?.indexes?.find(index => index.nativeId === "record.lookup-equality");
    expect(existing?.fields).toEqual(["lookup", "note"]);
    expect(equality?.fields).toEqual(["lookup"]);
    expect(equality?.indexName).not.toBe(existing?.indexName);
  });

  it("retains the existing FK descriptor and references while adding an exact equality alias", async () => {
    const definition = await Effect.runPromise(compile("foreign-key")), table = definition.tables.find(table => table.localName === "record");
    if (table?.table === undefined) throw new Error("Missing FK alias table");
    const physical = await Effect.runPromise(coreNativeIndexName(table.table, "index", "foreign-key/record.lookup"));
    expect(table.indexes?.map(index => index.nativeId)).toEqual([
      "record.primary", "record.active-lookup", "foreign-key/record.lookup", "record.lookup-equality",
    ]);
    expect(table.indexes?.find(index => index.nativeId === "record.lookup-equality"))
      .toMatchObject({ indexName: physical, fields: ["lookup"] });
    expect(definition.foreignKeys?.[0]).toMatchObject({ descriptor: "record.lookup", sourceIndexName: physical });
    expect(definition.schema.tables.find(candidate => candidate.tableName === table.name)?.indexes
      .filter(index => index.indexDescriptor === physical)).toHaveLength(1);
  });

  it("keeps an exact native-ID and field alias single rather than duplicating its metadata", async () => {
    const definition = await Effect.runPromise(compile("foreign-key-alias")), table = definition.tables.find(table => table.localName === "record");
    expect(table?.indexes?.filter(index => index.nativeId === "foreign-key/record.lookup")).toHaveLength(1);
    expect(table?.indexes?.find(index => index.nativeId === "foreign-key/record.lookup")?.fields).toEqual(["lookup"]);
  });

  for (const coverage of ["foreign-key-collision", "reverse-collision"] as const) {
    it(`refuses a declared equality ${coverage} on different fields`, async () => {
      const result = await Effect.runPromise(Effect.result(compile(coverage)));
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreSchemaError", reason: "unsupportedCapability",
        message: "Relational equality access path collides with a native declaration" } });
    });
  }

  it("keeps native text equality admission separate from ordered range and search admission", async () => {
    const definition = await Effect.runPromise(compileNativeDeclaredEqualityDefinition()), table = definition.tables[0];
    if (table === undefined) throw new Error("Missing equality table");
    const policy = coreNativeRelationalRows(definition, table.name);
    if (policy === undefined) throw new Error("Missing real relational row policy");
    const query = { fields: ["id"], order: { column: "id", direction: "asc" } };
    const equality = Result.getOrThrow(prepareCoreNativeRelationalRead(policy,
      { ...query, predicate: { kind: "in", column: "lookup", values: ["selected"] } }, 32));
    expect(equality.selections).toEqual([{ column: "lookup", value: "selected" }]);
    for (const predicate of [{ kind: "greaterThan", column: "lookup", value: "a" },
      { kind: "postgresText", column: "lookup", operator: "ilike", value: "%a%" }]) {
      expect(prepareCoreNativeRelationalRead(policy, { ...query, predicate }, 32))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "CoreNativeQueryError", reason: "invalidInput" } });
    }
  });
});
