import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, relationalForeignKeyReverseColumns } from "flarex-protocol/internal/relational-schema";
import { compileLogicalRelationalRead, prepareLogicalRelationalRead } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { prepareLogicalRelationalTableMechanics } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { syntheticSchemaInput } from "../../installation/frameworkSchema/frameworkMigrationValueFixtures";

const failure = (reason: string) => new Error(reason);

describe("selected relational read access", () => {
  it("keeps both native uniqueness OR branches indexed beneath an inherited active-row predicate", () => {
    const origin = { kind: "authored", sourceId: "fixture.link-uniqueness" };
    const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "link-uniqueness", capabilities: [], tables: [{
      tableId: "links", origin, columns: ["id", "variant_id", "price_set_id", "deleted_at"].map(columnId => ({
        columnId, type: "text", nullable: columnId === "deleted_at", default: { kind: "none" }, origin,
      })), keys: [{ keyId: "endpoints", kind: "primary", columns: ["variant_id", "price_set_id"], origin }],
      indexes: [
        { indexId: "id", kind: "btree", columns: ["id"], predicate: null, origin },
        ...["variant_id", "price_set_id"].map(columnId => ({ indexId: columnId, kind: "uniqueBtree", columns: [columnId],
          predicate: { kind: "isNull", columnId: "deleted_at" }, origin })),
        { indexId: "deleted", kind: "btree", columns: ["deleted_at"], predicate: null, origin },
        { indexId: "active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
      ], constraints: [], relationships: [],
    }] }));
    const original = schema.tables[0];
    if (original === undefined) throw new Error("Missing Link uniqueness fixture");
    const branch = (column: string, value: string) => ({ kind: "and", children: [{ kind: "in", column, values: [value] }] });
    // Native Link.create probes {$or:[{$or:[{variant_id},{price_set_id}]}]}.
    // The read owner adds its active-row predicate outside those nested groups.
    const input = { order: { column: "variant_id", direction: "asc" }, take: 1, predicate: { kind: "and", children: [
      { kind: "and", children: [{ kind: "or", children: [{ kind: "and", children: [{ kind: "or", children: [
        branch("variant_id", "new-variant"), branch("price_set_id", "new-set"),
      ] }] }] }] }, { kind: "isNull", column: "deleted_at" },
    ] } };
    const compact = { ...original, indexes: [] }, mechanics = prepareLogicalRelationalTableMechanics(compact, []);
    const selected = Result.getOrThrow(compileLogicalRelationalRead(compact, [], input, 128, failure, mechanics,
      { indexes: original.indexes, keys: original.keys, scalarColumns: [] }));
    const full = Result.getOrThrow(compileLogicalRelationalRead(original, [], input, 128, failure));
    for (const plan of [selected, full]) {
      expect(plan.selections).not.toBeNull();
      expect(plan.selections).toHaveLength(2);
      expect(plan.selections?.map(selection => selection.kind === "point" ? selection.columns : selection.column))
        .toEqual(["variant_id", "price_set_id"]);
      expect(plan.requiredNulls).toEqual(["deleted_at"]);
      expect(Result.getOrThrow(plan.inspect({ id: "old", variant_id: "unrelated", price_set_id: "unrelated", deleted_at: null })).matches).toBe(false);
      expect(Result.getOrThrow(plan.inspect({ id: "match", variant_id: "new-variant", price_set_id: "another", deleted_at: null })).matches).toBe(true);
      expect(Result.getOrThrow(plan.inspect({ id: "deleted", variant_id: "another", price_set_id: "new-set", deleted_at: "deleted" })).matches).toBe(false);
    }
  });

  it("rejects malformed queries and preserves existing complexity and first-failure order before access facts", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(syntheticSchemaInput()));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing query fixture");
    const order = { column: "id", direction: "asc" };
    const prepare = (input: unknown) => prepareLogicalRelationalRead(table, schema.capabilities, input, 10, failure);
    const invalid = { _tag: "Failure", failure: { message: "invalidInput" } };
    const exceeded = { _tag: "Failure", failure: { message: "limitExceeded" } };
    expect(prepare({ order, extra: true })).toMatchObject(invalid);
    expect(prepare({ order, predicate: { kind: "in", column: "parent_id", values: ["parent"], extra: true } })).toMatchObject(invalid);
    expect(prepare({ order, predicate: { kind: "in", column: "missing", values: ["value"] } })).toMatchObject(invalid);
    expect(prepare({ order, predicate: { kind: "in", column: "ordinal", values: ["value"] } })).toMatchObject(invalid);
    expect(prepare({ order, fields: ["missing"], take: 11, predicate: { kind: "unrecognized" } })).toMatchObject(invalid);
    expect(prepare({ order, take: 11, predicate: { kind: "unrecognized" } })).toMatchObject(exceeded);
    expect(prepare({ order, predicate: { kind: "and", children: Array.from({ length: 64 }, () => ({ kind: "isNull", column: "id" })) } }))
      .toMatchObject(exceeded);
    expect(prepare({ order, predicate: { kind: "in", column: "parent_id", values: Array.from({ length: 257 }, () => "value") } }))
      .toMatchObject(exceeded);
    let deep: unknown = { kind: "in", column: "parent_id", values: ["value"] };
    for (let index = 0; index < 9; index++) deep = { kind: "and", children: [deep] };
    expect(prepare({ order, predicate: deep })).toMatchObject(exceeded);
  });

  it("derives demand during validation and defers the existing access selection", () => {
    const origin = { kind: "authored", sourceId: "fixture.prepared-read" };
    const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "prepared-read", capabilities: [], tables: [{
      tableId: "items", origin, columns: ["id", "region", "code", "residual", "inactive"].map(columnId => ({ columnId, type: "text",
        nullable: columnId === "inactive", default: { kind: "none" }, origin })),
      keys: [{ keyId: "primary", kind: "primary", columns: ["id"], origin }],
      indexes: [{ indexId: "region-code", kind: "uniqueBtree", columns: ["region", "code"], predicate: null, origin }],
      constraints: [], relationships: [],
    }] }));
    const original = schema.tables[0];
    if (original === undefined) throw new Error("Missing prepared query fixture");
    const compact = { ...original, indexes: [] }, mechanics = prepareLogicalRelationalTableMechanics(compact, []);
    const input = { order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
      { kind: "indexedPoints", columns: ["region", "code"], values: [["eu", "code_a"]] },
      { kind: "greaterThan", column: "region", value: "a" },
      { kind: "textNotEqual", column: "residual", value: "hidden" },
      { kind: "textLikeAscii", column: "residual", pattern: "%value%" },
      { kind: "isNull", column: "inactive" },
    ] } };
    const prepared = Result.getOrThrow(prepareLogicalRelationalRead(compact, [], input, 10, failure, mechanics));
    expect(prepared.demand).toEqual({ fields: ["code", "region"], nulls: ["inactive"], points: [["region", "code"]] });
    expect(prepared.compile({ indexes: [], keys: [], scalarColumns: [] }))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
    const selected = Result.getOrThrow(prepared.compile({ indexes: original.indexes, keys: [], scalarColumns: [] }));
    const full = Result.getOrThrow(compileLogicalRelationalRead(original, [], input, 10, failure));
    expect({ selections: selected.selections, search: selected.search, json: selected.json, nulls: selected.requiredNulls })
      .toEqual({ selections: full.selections, search: full.search, json: full.json, nulls: full.requiredNulls });
  });

  it("preserves implicit FK reverse selection without loading the referenced table", () => {
    const input = syntheticSchemaInput();
    const schema = Result.getOrThrow(normalizeRelationalSchema({ ...input, tables: input.tables.map(table => table.tableId !== "child" ? table :
      { ...table, keys: table.keys.filter(key => key.kind === "primary"), indexes: [],
        relationships: table.relationships.map(relationship => ({ ...relationship, kind: "manyToOne" })) }) }));
    const original = schema.tables.find(table => table.identity.tableId === "child");
    if (original === undefined) throw new Error("Missing child fixture");
    const compact = { ...original, indexes: [], constraints: original.constraints.filter(constraint => constraint.kind !== "foreignKey"), relationships: [] };
    const mechanics = prepareLogicalRelationalTableMechanics(compact, []);
    const query = { order: { column: "id", direction: "asc" }, predicate: { kind: "in", column: "parent_id", values: ["parent_a"] } };
    const full = Result.getOrThrow(compileLogicalRelationalRead(original, schema.capabilities, query, 10, failure));
    const selected = Result.getOrThrow(compileLogicalRelationalRead(compact, [], query, 10, failure, mechanics,
      { indexes: [], keys: [], scalarColumns: relationalForeignKeyReverseColumns(original).map(column => column.columnId) }));
    expect(selected.selections).toEqual(full.selections);
    expect(selected.selections).toEqual([{ column: "parent_id", value: "parent_a" }]);
    expect(selected.inspect({ id: "child_a", parent_id: "parent_a", ordinal: -1 }))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    expect(Result.getOrThrow(selected.inspect({ id: "child_a", parent_id: "parent_a", ordinal: 1 })).matches).toBe(true);
  });

  it("retains complete unique-point selection and refuses missing access evidence", () => {
    const origin = { kind: "authored", sourceId: "fixture.selected-read" };
    const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "selected-read", capabilities: [], tables: [{
      tableId: "items", origin, columns: ["id", "region", "code"].map(columnId => ({ columnId, type: "text", nullable: false,
        default: { kind: "none" }, origin })), keys: [{ keyId: "primary", kind: "primary", columns: ["id"], origin }],
      indexes: [{ indexId: "region-code", kind: "uniqueBtree", columns: ["region", "code"], predicate: null, origin }],
      constraints: [], relationships: [],
    }] }));
    const original = schema.tables[0];
    if (original === undefined) throw new Error("Missing unique fixture");
    const compact = { ...original, indexes: [] }, mechanics = prepareLogicalRelationalTableMechanics(compact, []);
    const query = { order: { column: "id", direction: "asc" }, predicate: { kind: "indexedPoints", columns: ["region", "code"], values: [["eu", "code_a"]] } };
    const full = Result.getOrThrow(compileLogicalRelationalRead(original, [], query, 10, failure));
    const selected = Result.getOrThrow(compileLogicalRelationalRead(compact, [], query, 10, failure, mechanics,
      { indexes: original.indexes, keys: [], scalarColumns: [] }));
    expect(selected.selections).toEqual(full.selections);
    expect(compileLogicalRelationalRead(compact, [], query, 10, failure, mechanics,
      { indexes: [], keys: [], scalarColumns: [] })).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
    const mismatched = { ...compact, columns: [...compact.columns] };
    expect(compileLogicalRelationalRead(mismatched, [], query, 10, failure, mechanics,
      { indexes: original.indexes, keys: [], scalarColumns: [] })).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  });
});
