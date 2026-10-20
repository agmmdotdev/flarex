import { Result } from "effect";
import { PgDialect } from "drizzle-orm/pg-core";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, relationalReverseIndexes } from "flarex-protocol/internal/relational-schema";
import { compileLogicalRelationalRead, prepareLogicalRelationalRead } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { prepareLogicalRelationalTableMechanics } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { syntheticSchemaInput } from "../../installation/frameworkSchema/frameworkMigrationValueFixtures";
import { buildPostgresRelationalPredicateBody, decodePostgresRelationalMatches, inspectPostgresRelationalBatch,
  preparePostgresRelationalBatch } from "../../../src/storage/documents/logicalDocuments/postgresRelationalPredicate";

const failure = (reason: string) => new Error(reason);

describe("exact numeric terminal membership", () => {
  const origin = { kind: "synthetic", sourceId: "neutral-numeric-membership" };
  const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "numeric-membership", capabilities: [], tables: [{
    tableId: "measurements", origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin },
      { columnId: "label", type: "text", nullable: false, default: { kind: "none" }, origin },
    ], keys: [{ keyId: "measurements.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [],
  }] }));
  const table = schema.tables[0];
  if (table === undefined) throw new Error("Missing neutral numeric table");
  const order = { column: "id", direction: "asc" };
  const compile = (values: readonly (string | number)[], postgres = false) => compileLogicalRelationalRead(table, [], {
    fields: ["id"], order, predicate: { kind: "and", children: [
      { kind: "in", column: "id", values: ["selected"] }, { kind: "numericIn", column: "amount", values },
      ...(postgres ? [{ kind: "postgresText", column: "label", operator: "like", value: "%selected%" }] : []),
    ] },
  }, 8, failure);

  it("normalizes exact decimal aliases and signed zero without losing precision or changing access paths", () => {
    const values = [1, "1.0000", "9007199254740993.125", -0];
    const query = Result.getOrThrow(compile(values));
    values.splice(0, values.length, "changed after preparation");
    expect(query.selections).toEqual([{ column: "id", value: "selected" }]);
    for (const value of [1, "1.0000", "1e0", 0, "-0.000", "9007199254740993.125"]) {
      expect(Result.getOrThrow(query.inspect({ id: "selected", amount: value, label: "selected" })).matches).toBe(true);
    }
    for (const value of [null, "9007199254740993.126", "1.0000000000000000001"]) {
      expect(Result.getOrThrow(query.inspect({ id: "selected", amount: value, label: "selected" })).matches).toBe(false);
    }
    expect(Result.getOrThrow(compile([])).selections).toEqual([]);
  });

  it("validates complete stored rows before numeric matching and sparse projection", () => {
    const query = Result.getOrThrow(compile([1]));
    for (const row of [
      { id: "selected", amount: "invalid", label: "selected" },
      { id: "selected", amount: 1, label: 7 },
      { id: "selected", amount: null, label: "selected", undeclared: true },
    ]) expect(query.inspect(row)).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    const pg = Result.getOrThrow(compile([1], true));
    expect(pg.inspectRow({ id: "selected", amount: "invalid", label: "selected" }))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  });

  it("refuses wrong columns, malformed operands and unchanged legacy in numeric selections", () => {
    for (const predicate of [
      { kind: "numericIn", column: "label", values: [1] },
      { kind: "numericIn", column: "missing", values: [1] },
      { kind: "in", column: "amount", values: [1] },
      { kind: "in", column: "amount", values: ["1"] },
      ...[null, true, "NaN", " 1", "+1", "1\n", "1e999999", "1".repeat(1025)].map(value =>
        ({ kind: "numericIn", column: "amount", values: [value] })),
    ]) expect(compileLogicalRelationalRead(table, [], { order, predicate }, 8, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
    expect(compile(Array.from({ length: 257 }, () => 1)))
      .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  });

  it("lowers the complete mixed PostgreSQL tree using numeric casts and canonical string binds", () => {
    const query = Result.getOrThrow(compile([1, "1.0000", "9007199254740993.125", -0], true));
    if (query.postgresPredicate === undefined) throw new Error("Missing mixed PostgreSQL predicate");
    const tableId = decodeCatalogTableId(1);
    const batch = Result.getOrThrow(preparePostgresRelationalBatch(query.postgresPredicate, table, tableId,
      [{ id: "selected", amount: "9007199254740993.125", label: "selected" }], { rows: 8, bytes: 8192 }, failure));
    const statement = new PgDialect().sqlToQuery(Result.getOrThrow(buildPostgresRelationalPredicateBody(batch, tableId, failure)));
    expect(statement.sql).toContain("::numeric in (");
    expect(statement.params).toContain("1e0");
    expect(statement.params.filter(value => value === "1e0")).toHaveLength(1);
    expect(statement.params).toContain("9007199254740993125e-3"); expect(statement.params).toContain("0");
    expect(statement.params.some(value => typeof value === "number" && value > Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(query.selections).toEqual([{ column: "id", value: "selected" }]);
  });
});

describe("selected relational read access", () => {
  const postgresFixture = () => {
    const origin = { kind: "authored", sourceId: "fixture.postgres-predicate" };
    const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "postgres-predicate", capabilities: [], tables: [{
      tableId: "rows", origin, columns: ["id", "value", "deleted_at"].map(columnId => ({ columnId, type: "text",
        nullable: columnId !== "id", default: { kind: "none" }, origin })),
      keys: [{ keyId: "id", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [],
    }] }));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing PostgreSQL predicate fixture");
    return table;
  };

  it("retains the complete PostgreSQL predicate and indexed candidates without eager regex evaluation", () => {
    const table = postgresFixture();
    const regex = { kind: "postgresText", column: "value", operator: "regex", value: "[" };
    const query = Result.getOrThrow(compileLogicalRelationalRead(table, [], { order: { column: "id", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "in", column: "id", values: ["a"] }, { kind: "or", children: [
        { kind: "and", children: [] }, regex,
      ] }] } }, 4, failure));
    expect(query.selections).toEqual([{ column: "id", value: "a" }]);
    expect(query.inspect({ id: "a", value: "valid", deleted_at: null })).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
    expect(Result.getOrThrow(query.inspectRow({ id: "a", value: "valid", deleted_at: null })).order).toEqual(new TextEncoder().encode("a"));
    expect(query.inspectRow({ id: "a", value: 1, deleted_at: null })).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    if (query.postgresPredicate === undefined) throw new Error("Missing PostgreSQL predicate");
    // A later mutation of caller-owned source data cannot alter the program.
    regex.value = "changed";
    const tableId = decodeCatalogTableId(1);
    const batch = Result.getOrThrow(preparePostgresRelationalBatch(query.postgresPredicate, table, tableId,
      [{ id: "a", value: "valid", deleted_at: null }], { rows: 4, bytes: 8192 }, failure));
    const statement = new PgDialect().sqlToQuery(Result.getOrThrow(buildPostgresRelationalPredicateBody(batch, tableId, failure)));
    expect(statement.sql).toContain(" or ");
    expect(statement.sql).toContain("true");
    expect(statement.sql).toContain(" ~ ");
    expect(statement.sql).toContain("candidate_rows as materialized");
    expect(statement.sql).toContain("matches as materialized");
    expect(statement.sql).toContain("where");
    expect(statement.params).toContain("[");
    expect(statement.params).not.toContain("changed");
  });

  it("binds immutable PostgreSQL batches to their issuer/table and validates exact nullable result ordinals", () => {
    const table = postgresFixture(), tableId = decodeCatalogTableId(1), otherId = decodeCatalogTableId(2);
    const query = Result.getOrThrow(compileLogicalRelationalRead(table, [], { order: { column: "id", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "in", column: "id", values: ["a", "b"] },
        { kind: "postgresText", column: "value", operator: "notIn", values: ["excluded"] }] } }, 4, failure));
    if (query.postgresPredicate === undefined) throw new Error("Missing PostgreSQL predicate");
    const source = [{ id: "a", value: "kept", deleted_at: null }, { id: "b", value: null, deleted_at: null }];
    const bounds = { rows: 4, bytes: 8192 };
    const batch = Result.getOrThrow(preparePostgresRelationalBatch(query.postgresPredicate, table, tableId, source, bounds, failure));
    const first = source[0];
    if (first === undefined) throw new Error("Missing first candidate");
    first.value = "changed";
    expect(Result.getOrThrow(inspectPostgresRelationalBatch(batch, tableId, failure)).rows).toBe(2);
    expect(buildPostgresRelationalPredicateBody(batch, otherId, failure)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    const clone = structuredClone(batch);
    let inspected = 0;
    Object.defineProperty(clone, "anything", { get: () => { inspected++; throw new Error("Do not inspect foreign getters"); } });
    expect(inspectPostgresRelationalBatch(clone, tableId, failure)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    expect(inspected).toBe(0);
    expect(preparePostgresRelationalBatch(structuredClone(query.postgresPredicate), table, tableId, source, bounds, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    expect(preparePostgresRelationalBatch(query.postgresPredicate, { ...table }, tableId, source, bounds, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    expect(preparePostgresRelationalBatch(query.postgresPredicate, table, tableId, source, { ...bounds, rows: 1 }, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
    expect(preparePostgresRelationalBatch(query.postgresPredicate, table, tableId, source, { ...bounds, bytes: 1 }, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
    expect(preparePostgresRelationalBatch(query.postgresPredicate, table, tableId,
      [{ id: "a", value: "x".repeat(1_048_576), deleted_at: null }],
      { rows: Number.MAX_SAFE_INTEGER, bytes: Number.MAX_SAFE_INTEGER }, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
    const statement = new PgDialect().sqlToQuery(Result.getOrThrow(buildPostgresRelationalPredicateBody(batch, tableId, failure)));
    expect(statement.params).toContain(JSON.stringify([{ id: "a", value: "kept", deleted_at: null }, { id: "b", value: null, deleted_at: null }]));
    expect(Result.getOrThrow(decodePostgresRelationalMatches(batch, tableId,
      [{ ordinal: 0, matched: true }, { ordinal: 1, matched: null }], failure)).matches).toEqual([true, null]);
    for (const malformed of [[{ ordinal: 1, matched: true }, { ordinal: 0, matched: false }], [{ ordinal: 0, matched: true }],
      [{ ordinal: 0, matched: true }, { ordinal: 0, matched: false }], [{ ordinal: 0, matched: true, extra: 1 }, { ordinal: 1, matched: null }]])
      expect(decodePostgresRelationalMatches(batch, tableId, malformed, failure)).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  });
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
      { indexes: [], keys: [], scalarColumns: relationalReverseIndexes(original).map(index => index.column.columnId) }));
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

  it("uses the authenticated composite-key suffix reverse fact without treating a partial index as complete", () => {
    const origin = { kind: "authored", sourceId: "fixture.composite-reverse" };
    const schemaInput = { owner: "medusa", lineageId: "composite-reverse", capabilities: [], tables: [{
      tableId: "pairs", origin, columns: ["left_id", "right_id", "unindexed", "deleted_at"].map(columnId => ({
        columnId, type: "text", nullable: columnId === "deleted_at", default: { kind: "none" }, origin,
      })), keys: [{ keyId: "pair", kind: "primary", columns: ["left_id", "right_id"], origin }],
      indexes: [{ indexId: "right-active", kind: "btree", columns: ["right_id"],
        predicate: { kind: "isNull", columnId: "deleted_at" }, origin }], constraints: [], relationships: [],
    }] };
    const schema = Result.getOrThrow(normalizeRelationalSchema(schemaInput));
    const original = schema.tables[0];
    if (original === undefined) throw new Error("Missing pair fixture");
    const compact = { ...original, indexes: [] }, mechanics = prepareLogicalRelationalTableMechanics(compact, []);
    const query = { order: { column: "left_id", direction: "asc" }, predicate: { kind: "in", column: "right_id", values: ["selected"] } };
    const full = Result.getOrThrow(compileLogicalRelationalRead(original, [], query, 10, failure));
    const access = { indexes: original.indexes, keys: original.keys, scalarColumns: relationalReverseIndexes(original).map(index => index.column.columnId) };
    const selected = Result.getOrThrow(compileLogicalRelationalRead(compact, [], query, 10, failure, mechanics, access));
    expect(selected.selections).toEqual(full.selections);
    expect(selected.selections).toEqual([{ column: "right_id", value: "selected" }]);
    expect(selected.requiredNulls).toEqual([]);
    expect(Result.getOrThrow(selected.inspect({ left_id: "a", right_id: "selected", unindexed: "retained", deleted_at: "deleted" })).matches).toBe(true);
    const activeQuery = { ...query, predicate: { kind: "and", children: [query.predicate, { kind: "isNull", column: "deleted_at" }] } };
    const activeFull = Result.getOrThrow(compileLogicalRelationalRead(original, [], activeQuery, 8, failure));
    const activeSelected = Result.getOrThrow(compileLogicalRelationalRead(compact, [], activeQuery, 8, failure, mechanics, access));
    expect(activeSelected.selections).toEqual(activeFull.selections);
    expect(activeSelected.selections).toEqual([{ column: "right_id", value: "selected", nullColumn: "deleted_at" }]);
    expect(activeSelected.requiredNulls).toEqual(["deleted_at"]);
    expect(Result.getOrThrow(activeSelected.inspect({ left_id: "a", right_id: "selected", unindexed: "retained", deleted_at: "deleted" })).matches).toBe(false);
    expect(Result.getOrThrow(activeSelected.inspect({ left_id: "a", right_id: "selected", unindexed: "retained", deleted_at: null })).matches).toBe(true);
    // Declared unconditional prefixes keep their existing selection priority;
    // derived all-row alternatives yield to a native partial.
    const declaredSchema = Result.getOrThrow(normalizeRelationalSchema({ ...schemaInput,
      tables: schemaInput.tables.map(table => ({ ...table, indexes: [...table.indexes,
        { indexId: "right-complete", kind: "btree", columns: ["right_id"], predicate: null, origin }] })),
    }));
    const declared = declaredSchema.tables[0];
    if (declared === undefined) throw new Error("Missing native complete index fixture");
    const declaredFull = Result.getOrThrow(compileLogicalRelationalRead(declared, [], activeQuery, 8, failure));
    const declaredSelected = Result.getOrThrow(compileLogicalRelationalRead(compact, [], activeQuery, 8, failure, mechanics,
      { ...access, indexes: declared.indexes, scalarColumns: [] }));
    expect(declaredSelected.selections).toEqual(declaredFull.selections);
    expect(declaredSelected.selections).toEqual([{ column: "right_id", value: "selected" }]);
    // The real owner must issue the new complete reverse fact. A native active
    // index alone still cannot authorize an all-row query or a composite suffix.
    expect(compileLogicalRelationalRead(compact, [], query, 10, failure, mechanics, { ...access, scalarColumns: [] }))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
    expect(compileLogicalRelationalRead(compact, [], { ...query, predicate: { kind: "in", column: "unindexed", values: ["retained"] } }, 10, failure, mechanics, access))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
  });

});
