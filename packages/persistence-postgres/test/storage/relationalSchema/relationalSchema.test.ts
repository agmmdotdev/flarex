import { Effect, Result } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { canonicalizeFlarexValueV1Effect, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

// @ts-expect-error Relational schema values must remain absent from the root.
import type { RelationalSchema as RootRelationalSchema } from "../../../src";
import { captureRelationalSchemaArtifact } from
  "../../../src/storage/relationalSchema/artifact";
import {
  RelationalSchemaError,
} from "flarex-protocol/internal/relational-schema";
import type {
  RelationalColumnId,
  RelationalPersistenceCapabilityId,
  RelationalSchema,
  RelationalTableId,
} from "flarex-protocol/internal/relational-schema";
import {
  MAX_RELATIONAL_SCHEMA_DECODE_UNITS,
  normalizeRelationalSchema,
} from "flarex-protocol/internal/relational-schema";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { prepareLogicalRelationalRows, prepareLogicalRelationalTableMechanics, bindPreparedLogicalRelationalRows,
  canonicalizeLogicalRelationalRow, validateLogicalRelationalCanonicalRow, detachLogicalCanonicalDocument,
  captureLogicalRelationalCanonicalRow, inspectLogicalRelationalCanonicalRow,
  nativeLogicalRelationalCanonicalRow, captureLogicalRelationalActivityJson,
} from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { inspectCapturedPrivateJsonData, useCapturedPrivateJsonData } from "../../../src/values/privateJsonData";
import { decodeStoredAppDocumentEvidenceEffect, inspectStoredAppDocumentEvidence } from "../../../src/storage/documents/appRowCanonicalEvidence";
import { makeLogicalCommerceActivityProjection } from "../../../src/frameworks/commerceTransaction/logicalParticipant";
import { compileLogicalRelationalRead } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { canonicalizeAppUniqueKeyV1Result } from "../../../src/storage/unique/appUniqueKeyContract";
import { encodeOrderedIndexComponentsV1, orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
const rowFailure = (reason: string) => new Error(reason);

type PublicRelationalSchemaExport = Extract<
  keyof typeof import("../../../src"),
  | `${string}RelationalSchema${string}`
  | `${string}relationalSchema${string}`
  | `${string}RELATIONAL_SCHEMA${string}`
>;

type PlainStringIsRelationalIdentity = string extends
  RelationalTableId | RelationalColumnId | RelationalPersistenceCapabilityId
  ? true
  : false;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private relational schema values", () => {
  it("admits only the named empty JSON array default on JSONB columns", () => {
    const input = minimalInput();
    input.tables[0]?.columns.push({ columnId: "messages", type: "jsonb", nullable: false,
      default: { kind: "emptyJsonArray" }, origin: synthetic("fixture.messages") });
    const schema = Result.getOrThrow(normalizeRelationalSchema(input));
    expect(schema.tables[0]?.columns.find(column => column.identity.columnId === "messages")?.default)
      .toEqual({ kind: "emptyJsonArray" });
    for (const invalid of [
      { kind: "emptyJsonArray", value: [] }, { kind: "emptyJsonArray", extra: true },
      { kind: "jsonLiteral", value: [] }, { kind: "jsonLiteral", value: ["value"] },
      { kind: "jsonLiteral", value: {} },
    ]) {
      const altered = structuredClone(input);
      Reflect.set(altered.tables[0]?.columns[1] ?? {}, "default", invalid);
      expect(Result.isFailure(normalizeRelationalSchema(altered))).toBe(true);
    }
    const wrongType = minimalInput();
    Reflect.set(wrongType.tables[0]?.columns[0] ?? {}, "default", { kind: "emptyJsonArray" });
    expectInvalid(wrongType, "$.tables[only].columns[id].default");
  });

  it("allocates independent immutable logical array defaults while preserving explicit JSON and update values", () => {
    const input = minimalInput();
    input.tables[0]?.columns.push({ columnId: "messages", type: "jsonb", nullable: false,
      default: { kind: "emptyJsonArray" }, origin: synthetic("fixture.messages") });
    const schema = Result.getOrThrow(normalizeRelationalSchema(input));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing array default table");
    const rows = Result.getOrThrow(prepareLogicalRelationalRows(table, schema.capabilities, rowFailure));
    const first = Result.getOrThrow(rows.normalize({ id: "first" }, null, "2026-10-16T00:00:00.000Z"));
    const second = Result.getOrThrow(rows.normalize({ id: "second" }, null, "2026-10-16T00:00:00.000Z"));
    expect(first.messages).toEqual([]);
    expect(second.messages).toEqual([]);
    expect(first.messages).not.toBe(second.messages);
    expect(Object.isFrozen(first.messages)).toBe(true);
    const supplied = ["native", { nested: true }];
    const explicit = Result.getOrThrow(rows.normalize({ id: "explicit", messages: supplied }, null, "2026-10-16T00:00:00.000Z"));
    supplied.push("later mutation");
    expect(explicit.messages).toEqual(["native", { nested: true }]);
    expect(Result.getOrThrow(rows.normalize({ id: "explicit" }, explicit, "2026-10-17T00:00:00.000Z")).messages)
      .toEqual(["native", { nested: true }]);
    // This default does not impose a new array-only constraint on ordinary JSONB values.
    expect(Result.getOrThrow(rows.normalize({ id: "object", messages: { existing: true } }, null,
      "2026-10-16T00:00:00.000Z")).messages).toEqual({ existing: true });
    expect(Result.isFailure(rows.normalize({ id: "null", messages: null }, null, "2026-10-16T00:00:00.000Z"))).toBe(true);
  });

  it("records the named empty-array capability without changing older serialized artifacts", async () => {
    const input = minimalInput();
    input.tables[0]?.columns.push({ columnId: "messages", type: "jsonb", nullable: false,
      default: { kind: "emptyJsonArray" }, origin: synthetic("fixture.messages") });
    const captured = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a", schema: input,
      provenance: { kind: "synthetic", fixtureId: "array-default" } }));
    expect(captured.artifact.capabilities).toContain("relational-schema.default.emptyJsonArray");
    const previous = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a", schema: minimalInput(),
      provenance: { kind: "synthetic", fixtureId: "golden" } }));
    expect(previous.artifact.canonicalJson).toBe(GOLDEN_CANONICAL_JSON);
    expect(previous.artifact.identity.artifactSha256).toBe(GOLDEN_SHA256);
  });

  it("remains private, nominally typed, and Result-based", () => {
    expectTypeOf<PublicRelationalSchemaExport>().toEqualTypeOf<never>();
    expectTypeOf<PlainStringIsRelationalIdentity>().toEqualTypeOf<false>();
    expectTypeOf<RelationalTableId>().not.toMatchTypeOf<RelationalColumnId>();
    expectTypeOf<RelationalColumnId>()
      .not.toMatchTypeOf<RelationalPersistenceCapabilityId>();
    expectTypeOf<ReturnType<typeof normalizeRelationalSchema>>()
      .toEqualTypeOf<Result.Result<RelationalSchema, RelationalSchemaError>>();
    const unsupported = RelationalSchemaError.unsupportedCapability(
      "$.owner",
      "payload",
    );
    if (unsupported.reason === "unsupportedCapability") {
      expectTypeOf(unsupported.capability).toEqualTypeOf<string>();
    }
    const invalid = RelationalSchemaError.invalidInput("$.owner");
    if (invalid.reason === "invalidInput") {
      expectTypeOf(invalid.capability).toEqualTypeOf<undefined>();
    }
  });

  it("normalizes the exact Currency storage facts without treating search as an index", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
    const table = schema.tables[0];

    expect(schema.coordinate).toEqual({
      owner: "medusa",
      lineageId: "commerce",
    });
    expect(table?.identity.tableId).toBe("currency");
    expect(table?.columns.map(column => [
      column.identity.columnId,
      column.type,
      column.nullable,
      column.default.kind,
      column.origin.kind,
    ])).toEqual([
      ["code", "text", false, "none", "authored"],
      ["created_at", "timestamptz", false, "currentTimestamp", "implicit"],
      ["decimal_digits", "integer", false, "integerLiteral", "authored"],
      ["deleted_at", "timestamptz", true, "none", "implicit"],
      ["name", "text", false, "none", "authored"],
      ["raw_rounding", "jsonb", false, "exactNumericRawLiteral", "derived"],
      ["rounding", "numeric", false, "exactNumericLiteral", "authored"],
      ["symbol", "text", false, "none", "authored"],
      ["symbol_native", "text", false, "none", "authored"],
      ["updated_at", "timestamptz", false, "currentTimestamp", "implicit"],
    ]);
    expect(table?.keys).toHaveLength(1);
    expect(table?.keys[0]).toMatchObject({
      kind: "primary",
      columns: [{ columnId: "code" }],
    });
    expect(table?.keys[0]?.columns.some(column => column.columnId === "id"))
      .toBe(false);
    expect(table?.indexes).toMatchObject([{
      kind: "btree",
      columns: [{ columnId: "deleted_at" }],
      predicate: { kind: "isNull", column: { columnId: "deleted_at" } },
    }]);
    expect(table?.indexes.some(index =>
      index.columns.some(column =>
        column.columnId === "code" || column.columnId === "name"
      )
    )).toBe(false);
    const column = (columnId: string) => table?.columns.find(
      candidate => candidate.identity.columnId === columnId,
    );
    expect(column("decimal_digits")?.default).toEqual({
      kind: "integerLiteral",
      value: 0,
    });
    expect(column("rounding")?.default).toEqual({
      kind: "exactNumericLiteral",
      value: "0",
    });
    expect(column("raw_rounding")).toMatchObject({
      nullable: false,
      default: {
        kind: "exactNumericRawLiteral",
        value: "0",
        precision: 20,
      },
      origin: {
        kind: "derived",
        sourceId: "dml.big-number.raw_rounding",
      },
    });
    expect(schema.capabilities.map(capability => capability.kind)).toEqual([
      "exactNumericCompanion",
      "searchableText",
      "softDelete",
      "managedTimestamps",
    ]);
    expect(schema.capabilities).toMatchObject([
      {
        kind: "exactNumericCompanion",
        numericColumn: { tableId: "currency", columnId: "rounding" },
        rawColumn: { tableId: "currency", columnId: "raw_rounding" },
      },
      {
        kind: "searchableText",
        columns: [
          { tableId: "currency", columnId: "code" },
          { tableId: "currency", columnId: "name" },
        ],
      },
      {
        kind: "softDelete",
        deletedAtColumn: { tableId: "currency", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "currency", indexId: "currency.active" },
      },
      {
        kind: "managedTimestamps",
        createdAtColumn: { tableId: "currency", columnId: "created_at" },
        updatedAtColumn: { tableId: "currency", columnId: "updated_at" },
        updateBehavior: "currentTimestampOnUpdate",
      },
    ]);
  });

  it("admits the synthetic key, index, check, foreign-key, and relationship vocabulary", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(syntheticInput()));
    const child = schema.tables.find(table => table.identity.tableId === "child");
    const parent = schema.tables.find(table => table.identity.tableId === "parent");

    expect(parent?.keys.map(key => key.kind)).toEqual(["primary", "unique"]);
    expect(child?.indexes).toMatchObject([
      {
        kind: "btree",
        columns: [{ columnId: "alternate_parent_id" }],
        predicate: null,
      },
      {
        kind: "btree",
        columns: [{ columnId: "parent_id" }],
        predicate: null,
      },
    ]);
    expect(child?.constraints.map(constraint => constraint.kind)).toEqual([
      "foreignKey",
      "integerRange",
      "foreignKey",
    ]);
    expect(child?.relationships).toMatchObject([
      {
        kind: "manyToOne",
        foreignKey: { constraintId: "child.alternate-parent" },
      },
      {
        kind: "manyToOne",
        foreignKey: { constraintId: "child.parent" },
      },
    ]);
  });

  it("classifies composite relationship cardinality by unique column set", () => {
    const schema = Result.getOrThrow(
      normalizeRelationalSchema(compositeRelationshipInput()),
    );
    const child = schema.tables.find(table => table.identity.tableId === "child");
    expect(child?.relationships).toMatchObject([{
      kind: "oneToOne",
      foreignKey: { constraintId: "child.parent" },
    }]);

    const wrongCardinality = compositeRelationshipInput();
    Reflect.set(
      wrongCardinality.tables[0]?.relationships[0] ?? {},
      "kind",
      "manyToOne",
    );
    expectInvalid(
      wrongCardinality,
      "$.tables[child].relationships[child.parent]",
    );
  });

  it.each([false, true])("admits default-free numeric columns with nullable generated companions (numeric nullable %s)", nullable => {
    const input = currencyInput();
    for (const column of input.tables[0]?.columns ?? []) {
      if (["rounding", "raw_rounding"].includes(column.columnId)) {
        Reflect.set(column, "default", { kind: "none" });
        Reflect.set(column, "nullable", column.columnId === "raw_rounding" || nullable);
      }
    }
    expect(Result.isSuccess(normalizeRelationalSchema(input))).toBe(true);
  });

  it.each(["rounding", "raw_rounding"])("rejects a one-sided default on %s", columnId => {
    const input = currencyInput();
    Reflect.set(input.tables[0]?.columns.find(column => column.columnId === columnId) ?? {}, "default", { kind: "none" });
    expectInvalid(input, "$.capabilities[currency.exact-number]");
  });

  it("requires a nullable companion when the numeric column is nullable", () => {
    const nullable = currencyInput();
    const nullableColumns = nullable.tables[0]?.columns ?? [];
    Reflect.set(
      nullableColumns.find(column => column.columnId === "rounding") ?? {},
      "nullable",
      true,
    );
    Reflect.set(
      nullableColumns.find(column => column.columnId === "raw_rounding") ?? {},
      "nullable",
      true,
    );
    expect(Result.isSuccess(normalizeRelationalSchema(nullable))).toBe(true);

    const mismatched = currencyInput();
    Reflect.set(
      mismatched.tables[0]?.columns.find(
        column => column.columnId === "rounding",
      ) ?? {},
      "nullable",
      true,
    );
    expectInvalid(mismatched, "$.capabilities[currency.exact-number]");
  });

  it("admits only PostgreSQL text and integer literal values", () => {
    for (const value of [-2_147_483_648, 2_147_483_647]) {
      expect(Result.isSuccess(
        normalizeRelationalSchema(minimalIntegerInput(value)),
      )).toBe(true);
    }
    const negativeZero = Result.getOrThrow(
      normalizeRelationalSchema(minimalIntegerInput(-0)),
    );
    const normalizedNegativeZero = negativeZero.tables[0]?.columns[0]?.default;
    expect(normalizedNegativeZero).toEqual({
      kind: "integerLiteral",
      value: 0,
    });
    if (normalizedNegativeZero?.kind === "integerLiteral") {
      expect(Object.is(normalizedNegativeZero.value, -0)).toBe(false);
    }

    expectInvalid(
      minimalIntegerInput(-2_147_483_649),
      "$.tables[0].columns[0].default.value",
    );
    expectInvalid(
      minimalIntegerInput(2_147_483_648),
      "$.tables[0].columns[0].default.value",
    );

    const nulText = minimalInput();
    Reflect.set(nulText.tables[0]?.columns[0] ?? {}, "default", {
      kind: "textLiteral",
      value: "not\0postgres",
    });
    expectInvalid(nulText, "$.tables[0].columns[0].default.value");

    const rangeViolation = syntheticInput();
    const ordinal = rangeViolation.tables[0]?.columns.find(
      column => column.columnId === "ordinal",
    );
    Reflect.set(ordinal ?? {}, "default", { kind: "integerLiteral", value: -1 });
    expectInvalid(
      rangeViolation,
      "$.tables[child].constraints[child.ordinal-range].column",
    );
  });

  it("selects only null predicates required by every Boolean branch", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing Currency table");
    const compile = (predicate: unknown) => Result.getOrThrow(compileLogicalRelationalRead(table, schema.capabilities,
      { order: { column: "code", direction: "asc" }, predicate }, 10, reason => new Error(reason)));
    expect(compile({ kind: "and", children: [
      { kind: "isNull", column: "deleted_at" },
      { kind: "or", children: [{ kind: "in", column: "code", values: ["USD"] },
        { kind: "in", column: "code", values: ["EUR"] }] },
    ] }).requiredNulls).toEqual(["deleted_at"]);
    expect(compile({ kind: "or", children: [
      { kind: "and", children: [{ kind: "isNull", column: "deleted_at" },
        { kind: "in", column: "code", values: ["USD"] }] },
      { kind: "and", children: [{ kind: "isNull", column: "deleted_at" },
        { kind: "in", column: "code", values: ["EUR"] }] },
    ] }).requiredNulls).toEqual(["deleted_at"]);
    expect(compile({ kind: "or", children: [{ kind: "isNull", column: "deleted_at" },
      { kind: "and", children: [] }] }).requiredNulls).toEqual([]);
    expect(compile({ kind: "isNull", column: "code" }).requiredNulls).toEqual([]);
  });

  it("selects exact Boolean membership only through a declared index", () => {
    const base = currencyInput();
    const input = { ...base, tables: base.tables.map(table => ({ ...table, columns: [...table.columns,
      { columnId: "is_disabled", type: "boolean", nullable: false,
        default: { kind: "booleanLiteral", value: false },
        origin: authored("packages/modules/currency/src/models/currency.ts#currency.is_disabled") }],
    })) };
    const schema = Result.getOrThrow(normalizeRelationalSchema(input));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing relational table");
    const query = Result.getOrThrow(compileLogicalRelationalRead(table, schema.capabilities,
      { order: { column: "code", direction: "asc" }, predicate: { kind: "in", column: "is_disabled", values: [true] } },
      10, reason => new Error(reason)));
    expect(query.selections).toBeNull();
    const indexed = Result.getOrThrow(normalizeRelationalSchema({ ...input, tables: input.tables.map(table => ({
      ...table, indexes: [...table.indexes, { indexId: "currency.disabled", kind: "btree",
        columns: ["is_disabled"], predicate: null,
        origin: derived("currency.disabled-equality") }],
    })) }));
    const indexedTable = indexed.tables[0];
    if (indexedTable === undefined) throw new Error("Missing indexed relational table");
    const compile = (predicate: unknown) => Result.getOrThrow(compileLogicalRelationalRead(indexedTable,
      indexed.capabilities, { order: { column: "code", direction: "asc" }, predicate }, 10, reason => new Error(reason)));
    expect(compile({ kind: "in", column: "is_disabled", values: [true] }).selections)
      .toEqual([{ column: "is_disabled", value: true }]);
    expect(compile({ kind: "or", children: [
      { kind: "in", column: "is_disabled", values: [true] },
      { kind: "in", column: "is_disabled", values: [false] },
    ] }).selections).toEqual([{ column: "is_disabled", value: true }, { column: "is_disabled", value: false }]);
    expect(Result.isFailure(compileLogicalRelationalRead(table, schema.capabilities,
      { order: { column: "code", direction: "asc" }, predicate: { kind: "in", column: "is_disabled", values: ["true"] } },
      10, reason => new Error(reason)))).toBe(true);
  });

  it("selects complete compound points only through an admitted unique index", () => {
    const base = currencyInput();
    const schema = Result.getOrThrow(normalizeRelationalSchema({ ...base, tables: base.tables.map(table => ({
      ...table,
      columns: [...table.columns,
        scalarColumn("attribute", "text", authored("test.preference.attribute")),
        scalarColumn("value", "text", authored("test.preference.value"))],
      indexes: [...table.indexes, { indexId: "currency.preference-pair", kind: "uniqueBtree",
        columns: ["attribute", "value"], predicate: { kind: "isNull", columnId: "deleted_at" },
        origin: derived("test.preference-pair") }],
    })) }));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing compound-index table");
    const points = { kind: "indexedPoints", columns: ["attribute", "value"], values: [
      ["region_id", "region"], ["currency_code", "USD"],
    ] };
    const compile = (predicate: unknown) => compileLogicalRelationalRead(table, schema.capabilities,
      { order: { column: "code", direction: "asc" }, predicate }, 10, reason => new Error(reason));
    expect(Result.getOrThrow(compile({ kind: "and", children: [points,
      { kind: "isNull", column: "deleted_at" }] })).selections).toEqual([
      { kind: "point", columns: ["attribute", "value"], values: ["region_id", "region"], nullColumn: "deleted_at" },
      { kind: "point", columns: ["attribute", "value"], values: ["currency_code", "USD"], nullColumn: "deleted_at" },
    ]);
    expect(Result.isFailure(compile(points))).toBe(true);
    expect(Result.isFailure(compile({ ...points, values: [["region_id"]] }))).toBe(true);
  });

  it("selects canonical timestamp greater-than ranges only through an ordered index", () => {
    const base = currencyInput();
    const plain = Result.getOrThrow(normalizeRelationalSchema(base));
    const table = plain.tables[0];
    if (table === undefined) throw new Error("Missing Currency table");
    const order = { column: "code", direction: "asc" };
    const predicate = { kind: "greaterThan", column: "deleted_at", value: "2026-01-01T00:00:00.000Z" };
    expect(Result.isFailure(compileLogicalRelationalRead(table, plain.capabilities,
      { order, predicate }, 10, reason => new Error(reason)))).toBe(true);
    const indexed = Result.getOrThrow(normalizeRelationalSchema({ ...base, tables: base.tables.map(value => ({
      ...value, indexes: [...value.indexes, { indexId: "currency.deleted-range", kind: "btree",
        columns: ["deleted_at"], predicate: null, origin: derived("currency.deleted-range") }],
    })) }));
    const indexedTable = indexed.tables[0];
    if (indexedTable === undefined) throw new Error("Missing indexed Currency table");
    const read = Result.getOrThrow(compileLogicalRelationalRead(indexedTable, indexed.capabilities,
      { order, predicate }, 10, reason => new Error(reason)));
    expect(read.selections).toEqual([{ column: "deleted_at", value: { gt: predicate.value } }]);
    const rows = Result.getOrThrow(prepareLogicalRelationalRows(indexedTable, indexed.capabilities,
      () => new Error("Invalid Currency row")));
    const row = (deletedAt: string | null) => Result.getOrThrow(rows.normalize({
      code: "USD", symbol: "$", symbol_native: "$", name: "US Dollar", decimal_digits: 2,
      deleted_at: deletedAt,
    }, null, "2026-01-01T00:00:00.000Z"));
    expect(Result.getOrThrow(read.inspect(row("2026-01-01T00:00:00.001Z"))).matches).toBe(true);
    expect(Result.getOrThrow(read.inspect(row("2026-01-01T00:00:00.000Z"))).matches).toBe(false);
    expect(Result.getOrThrow(read.inspect(row(null))).matches).toBe(false);
    expect(Result.isFailure(compileLogicalRelationalRead(indexedTable, indexed.capabilities,
      { order, predicate: { ...predicate, value: "01-01-2022" } }, 10, reason => new Error(reason)))).toBe(true);
  });

  it("selects a complete indexed ASCII LIKE anchor and retains conjunct residuals", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing Currency table");
    const order = { column: "code", direction: "asc" };
    const search = { kind: "textLikeAscii", column: "name", pattern: "%test%" };
    const compile = (predicate: unknown) => compileLogicalRelationalRead(table, schema.capabilities,
      { order, predicate }, 10, reason => new Error(reason));
    expect(Result.getOrThrow(compile(search)).search).toEqual([{ column: "name", pattern: "%test%" }]);
    const read = Result.getOrThrow(compile({ kind: "and", children: [
      { kind: "isNull", column: "deleted_at" }, search,
    ] }));
    expect(read.requiredNulls).toEqual(["deleted_at"]);
    expect(read.requiresIndexedNullAnchor).toBe(false);
    expect(read.search).toEqual([{ column: "name", pattern: "%test%" }]);
    const short = { kind: "textLikeAscii", column: "name", pattern: "%t%" };
    expect(Result.isFailure(compile(short))).toBe(true);
    expect(Result.getOrThrow(compile({ kind: "and", children: [
      { kind: "isNull", column: "deleted_at" }, short,
    ] })).requiresIndexedNullAnchor).toBe(true);
    for (const children of [[short, search], [search, short]]) {
      const combined = Result.getOrThrow(compile({ kind: "and", children }));
      expect(combined.search).toEqual([{ column: "name", pattern: "%test%" }]);
    }
    const selected = Result.getOrThrow(compile({ kind: "and", children: [
      { kind: "in", column: "code", values: ["USD"] }, search,
    ] }));
    expect(selected.search).toBeNull();
    expect(selected.selections).toEqual([{ column: "code", value: "USD" }]);
    const empty = Result.getOrThrow(compile({ kind: "and", children: [
      { kind: "in", column: "code", values: [] }, search,
    ] }));
    expect(empty.search).toBeNull();
    expect(empty.selections).toEqual([]);
    const points = Result.getOrThrow(compile({ kind: "and", children: [
      { kind: "in", column: "code", values: ["USD", "EUR"] }, search,
    ] }));
    expect(points.search).toBeNull();
    expect(points.selections).toEqual([{ column: "code", value: "USD" }, { column: "code", value: "EUR" }]);
    const withBroadIndex = currencyInput();
    withBroadIndex.tables[0]?.indexes.push({ indexId: "currency.symbol", kind: "btree", columns: ["symbol"],
      predicate: { kind: "isNull", columnId: "deleted_at" }, origin: authored("currency.symbol.index") });
    const broadSchema = Result.getOrThrow(normalizeRelationalSchema(withBroadIndex));
    const broadTable = broadSchema.tables[0];
    if (broadTable === undefined) throw new Error("Missing Currency table");
    for (const columns of [["symbol", "code"], ["code", "symbol"]]) {
      const point = Result.getOrThrow(compileLogicalRelationalRead(broadTable, broadSchema.capabilities,
        { order, predicate: { kind: "and", children: [
          { kind: "isNull", column: "deleted_at" },
          ...columns.map(column => ({ kind: "in", column, values: [column === "code" ? "USD" : "$"] })), search,
        ] } }, 10, reason => new Error(reason)));
      expect(point.selections).toEqual([{ column: "code", value: "USD" }]);
      expect(point.search).toBeNull();
    }
    const rows = Result.getOrThrow(prepareLogicalRelationalRows(table, schema.capabilities,
      () => new Error("Invalid Currency row")));
    const row = (name: string) => Result.getOrThrow(rows.normalize({
      code: "USD", symbol: "$", symbol_native: "$", name, decimal_digits: 2,
    }, null, "2026-01-01T00:00:00.000Z"));
    expect(Result.getOrThrow(read.inspect(row("My TEST product"))).matches).toBe(true);
    expect(Result.getOrThrow(read.inspect(row("Another product"))).matches).toBe(false);
    const literalSlash = Result.getOrThrow(compile({ kind: "and", children: [
      { kind: "isNull", column: "deleted_at" },
      { kind: "textLikeAscii", column: "name", pattern: "%A\\B_" },
    ] }));
    expect(Result.getOrThrow(literalSlash.inspect(row("xxa\\bZ"))).matches).toBe(true);
    expect(Result.isFailure(compile({ kind: "and", children: [
      { kind: "isNull", column: "deleted_at" },
      { kind: "textLikeAscii", column: "name", pattern: "%" + "x".repeat(257) + "%" },
    ] }))).toBe(true);
  });

  it("gives relational integer signed zero one stored, ordered and unique value", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing Currency table");
    const policy = Result.getOrThrow(prepareLogicalRelationalRows(table, schema.capabilities, () => new Error("Invalid relational row")));
    const timestamp = "2026-09-23T00:00:00.000Z";
    const row = (value: number) => Result.getOrThrow(policy.normalize({ code: "USD", symbol: "$", symbol_native: "$", name: "US Dollar", decimal_digits: value }, null, timestamp));
    const negative = row(-0);
    const positive = row(0);
    expect(Object.is(negative.decimal_digits, -0)).toBe(false);
    expect(negative.decimal_digits).toBe(positive.decimal_digits);
    const read = Result.getOrThrow(compileLogicalRelationalRead(table, schema.capabilities,
      { order: { column: "decimal_digits", direction: "asc" }, predicate: { kind: "in", column: "code", values: ["USD"] } },
      10, reason => new Error(reason)));
    expect(compareBytesLexicographically(Result.getOrThrow(read.inspect(row(2))).order,
      Result.getOrThrow(read.inspect(row(10))).order)).toBeLessThan(0);
    const component = (value: typeof negative) => orderedIndexValueFromFlarexValueV1(value.decimal_digits);
    expect(encodeOrderedIndexComponentsV1([component(negative)])).toBe(encodeOrderedIndexComponentsV1([component(positive)]));
    const claim = (value: typeof negative) => Result.getOrThrow(canonicalizeAppUniqueKeyV1Result({ sparse: false, localeKey: null, values: [component(value)] }));
    const negativeClaim = claim(negative);
    const positiveClaim = claim(positive);
    if (negativeClaim.kind !== "claim" || positiveClaim.kind !== "claim") throw new Error("Expected unique claims");
    expect(negativeClaim.encodedKey).toBe(positiveClaim.encodedKey);
    expect(policy.validate({ ...negative, decimal_digits: -0 }, "storedCorruption")).toMatchObject({ _tag: "Failure" });
  });

  it("preserves managed update time on native upsert conflict while advancing ordinary updates", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
    const table = schema.tables[0];
    if (table === undefined) throw new Error("Missing Currency table");
    const policy = Result.getOrThrow(prepareLogicalRelationalRows(table, schema.capabilities,
      () => new Error("Invalid relational row")));
    const firstTime = "2026-09-23T00:00:00.000Z";
    const nextTime = "2026-09-24T00:00:00.000Z";
    const first = Result.getOrThrow(policy.normalize({ code: "USD", symbol: "$",
      symbol_native: "$", name: "US Dollar", decimal_digits: 2 }, null, firstTime));
    const upserted = Result.getOrThrow(policy.normalize({ code: "USD", name: "Dollar" },
      first, nextTime, "preserve"));
    expect(upserted).toMatchObject({ name: "Dollar", created_at: firstTime,
      updated_at: firstTime });
    const updated = Result.getOrThrow(policy.normalize({ name: "Updated Dollar" },
      upserted, nextTime));
    expect(updated).toMatchObject({ name: "Updated Dollar", created_at: firstTime,
      updated_at: nextTime });
    // The pure row owner has no request/document allowance; a complete valid
    // row may exceed an eventual caller's bound and remain a semantic success.
    const largeName = "Dollar".repeat(16_384);
    const large = Result.getOrThrow(policy.normalize({ name: largeName }, updated, nextTime));
    expect(large.name).toBe(largeName);
    expect(large).toMatchObject({ created_at: firstTime, updated_at: nextTime });
  });

  it("retains only the issuing table's immutable normalized and canonical row evidence across owned byte copies", () =>
    runEffect(Effect.gen(function* () {
      const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
      const table = schema.tables[0];
      if (table === undefined) throw new Error("Missing row-evidence table");
      const mechanics = prepareLogicalRelationalTableMechanics(table, schema.capabilities);
      const foreign = prepareLogicalRelationalTableMechanics(table, schema.capabilities);
      const policy = Result.getOrThrow(bindPreparedLogicalRelationalRows(mechanics, reason => new Error(reason)));
      const input = { code: "USD", symbol: "$", symbol_native: "$", name: "Dollar", rounding: "1",
        raw_rounding: { value: "1", precision: 20 } };
      const fields = Result.getOrThrow(policy.normalize(input, null, "2026-10-10T00:00:00.000Z"));
      input.raw_rounding.value = "2";
      expect(fields.raw_rounding).toEqual({ value: "1", precision: 20 });
      expect(Object.isFrozen(fields)).toBe(true);
      expect(Object.isFrozen(fields.raw_rounding)).toBe(true);
      const tableId = CatalogTableIdSchema.make(1);
      const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId: decodeAppRowIdHexV1("00000000000000000000000000000001") });
      const time = AppCreationTimeV1Schema.make(1);
      expect(yield* Effect.result(canonicalizeLogicalRelationalRow(foreign, fields, documentId, time)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      expect(yield* Effect.result(canonicalizeLogicalRelationalRow(mechanics, { ...fields }, documentId, time)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      const document = yield* canonicalizeLogicalRelationalRow(mechanics, fields, documentId, time);
      const native = yield* canonicalizeFlarexValueV1Effect({ ...fields, _id: documentId, _creationTime: time }, "appDocument");
      expect(document.canonicalBytes).toEqual(native.canonicalBytes);
      expect(document.sha256).toEqual(native.sha256);
      const captured = Result.getOrThrow(captureLogicalRelationalCanonicalRow(document, 65_536, rowFailure));
      const again = Result.getOrThrow(captureLogicalRelationalCanonicalRow(document, 65_536, rowFailure));
      expect(again.value).toBe(captured.value);
      if (!isJsonObject(captured.value)) throw new Error("Missing captured runtime row");
      const nativeFields = Result.getOrThrow(nativeLogicalRelationalCanonicalRow(mechanics, document, 65_536, rowFailure));
      expect(nativeFields.raw_rounding).toBe(captured.value.raw_rounding);
      expect(Object.hasOwn(nativeFields, "_id")).toBe(false);
      expect(captured.value._id).toBe(documentId);
      expect(captured.value._creationTime).toBe(time);
      expect(inspectCapturedPrivateJsonData(nativeFields)?.value).toBe(nativeFields);
      expect(Result.getOrThrow(inspectLogicalRelationalCanonicalRow(mechanics, document, captured.value, "storedCorruption")))
        .toBe(nativeFields);
      expect(Result.getOrThrow(inspectLogicalRelationalCanonicalRow(foreign, document, captured.value, "storedCorruption")))
        .toBeUndefined();
      expect(Result.getOrThrow(inspectLogicalRelationalCanonicalRow(mechanics, document, { ...captured.value }, "storedCorruption")))
        .toBeUndefined();
      expect(captureLogicalRelationalCanonicalRow(document, captured.bytes - 1, rowFailure))
        .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      expect(Result.getOrThrow(captureLogicalRelationalCanonicalRow(document, captured.bytes, rowFailure)).bytes).toBe(captured.bytes);
      const query = Result.getOrThrow(compileLogicalRelationalRead(table, schema.capabilities,
        { fields: ["code"], order: { column: "code", direction: "asc" } }, 10, rowFailure, mechanics));
      expect(Result.getOrThrow(query.inspect(captured.value, document)).matches).toBe(true);
      expect(query.inspect(Object.freeze({ ...captured.value, decimal_digits: "hidden-bad-field" }), document))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      const changedTable = { ...table, columns: table.columns.map(column => column.identity.columnId === "decimal_digits"
        ? { ...column, type: "text" as const } : column) };
      const changedMechanics = prepareLogicalRelationalTableMechanics(changedTable, schema.capabilities);
      const changedQuery = Result.getOrThrow(compileLogicalRelationalRead(changedTable, schema.capabilities,
        { fields: ["code"], order: { column: "code", direction: "asc" } }, 10, rowFailure, changedMechanics));
      expect(changedQuery.inspect(captured.value, document))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      const returned = Result.getOrThrow(useCapturedPrivateJsonData([nativeFields], 65_536, rowFailure)).value;
      if (!Array.isArray(returned)) throw new Error("Missing returned row array");
      expect(returned[0]).toBe(nativeFields);
      const mutable: Record<string, Json> = { ...structuredClone(nativeFields) };
      expect(inspectCapturedPrivateJsonData(mutable)).toBeUndefined();
      mutable.name = "mutable native callback";
      expect(nativeFields.name).toBe("Dollar");
      const detached = detachLogicalCanonicalDocument(document);
      expect(detached.canonicalBytes).not.toBe(document.canonicalBytes);
      expect(detached.sha256).not.toBe(document.sha256);
      expect(Result.isSuccess(validateLogicalRelationalCanonicalRow(mechanics, detached, "documentInvalid"))).toBe(true);
      const forged = { ...document, value: { ...fields, decimal_digits: "forged", _id: documentId, _creationTime: time } };
      expect(validateLogicalRelationalCanonicalRow(mechanics, forged, "documentInvalid"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
      expect(validateLogicalRelationalCanonicalRow(foreign, forged, "storedCorruption"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      if (!isJsonObject(document.valueJson)) throw new Error("Missing canonical activity JSON");
      const observed = { documentId, tableId, tableName: "currency", value: document.valueJson };
      const activity = { attempts: [], lifecycle: [], observedRows: [observed], setNull: [], relationalReads: [], referenceReplacements: [] };
      const project = makeLogicalCommerceActivityProjection(new Map([[tableId, "currency"]]));
      const first = yield* project(activity), next = yield* project({ ...activity });
      expect(next.observedRows[0]?.row).toBe(first.observedRows[0]?.row);
      expect(Reflect.set(next.observedRows[0]?.row ?? {}, "name", "escaped")).toBe(false);
      detached.canonicalBytes.fill(0);
      expect(captureLogicalRelationalCanonicalRow(detached, 65_536, rowFailure))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      expect(inspectLogicalRelationalCanonicalRow(foreign, detached, captured.value, "storedCorruption"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      expect(validateLogicalRelationalCanonicalRow(mechanics, detached, "documentInvalid"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
      expect(validateLogicalRelationalCanonicalRow(mechanics, detachLogicalCanonicalDocument(detached), "storedCorruption"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      expect(Result.isSuccess(validateLogicalRelationalCanonicalRow(mechanics, document, "documentInvalid"))).toBe(true);
      document.sha256.fill(0);
      expect(validateLogicalRelationalCanonicalRow(mechanics, document, "storedCorruption"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    })));

  it("keeps issued runtime negative zero separate from tagged activity JSON through native handoffs", () =>
    runEffect(Effect.gen(function* () {
      const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
      const table = schema.tables[0];
      if (table === undefined) throw new Error("Missing signed-zero row table");
      const mechanics = prepareLogicalRelationalTableMechanics(table, schema.capabilities);
      const policy = Result.getOrThrow(bindPreparedLogicalRelationalRows(mechanics, rowFailure));
      const fields = Result.getOrThrow(policy.normalize({ code: "ZERO", symbol: "0", symbol_native: "0", name: "Signed zero",
        rounding: "0", raw_rounding: { value: "0", precision: 20, signed: -0 } }, null, "2026-10-10T00:00:00.000Z"));
      const documentId = appDocumentIdV1FromRowIdentity({ tableId: CatalogTableIdSchema.make(1),
        rowId: decodeAppRowIdHexV1("00000000000000000000000000000002") });
      const document = yield* canonicalizeLogicalRelationalRow(mechanics, fields, documentId, AppCreationTimeV1Schema.make(1));
      const native = Result.getOrThrow(nativeLogicalRelationalCanonicalRow(mechanics, document, 65_536, rowFailure));
      if (!isJsonObject(native.raw_rounding)) throw new Error("Missing native numeric companion");
      expect(Object.is(native.raw_rounding.signed, -0)).toBe(true);
      const policyJson = Result.getOrThrow(captureLogicalRelationalActivityJson(document, rowFailure)).value;
      expect(policyJson).toEqual(document.valueJson);
      expect(Result.getOrThrow(captureLogicalRelationalActivityJson(document, rowFailure)).value).toBe(policyJson);
      if (!isJsonObject(policyJson) || !isJsonObject(policyJson.raw_rounding)) throw new Error("Missing policy numeric companion");
      expect(policyJson.raw_rounding.signed).not.toBe(-0);
      const projected = Result.getOrThrow(useCapturedPrivateJsonData({ raw_rounding: native.raw_rounding }, 65_536, rowFailure)).value;
      if (!isJsonObject(projected)) throw new Error("Missing native projection");
      expect(projected.raw_rounding).toBe(native.raw_rounding);
      expect(inspectCapturedPrivateJsonData(projected)?.negativeZero).toBe(true);
    })));

  it("retains actual stored captures while deferring complete table semantics until query/write inspection", () =>
    runEffect(Effect.gen(function* () {
      const schema = Result.getOrThrow(normalizeRelationalSchema(currencyInput()));
      const table = schema.tables[0];
      if (table === undefined) throw new Error("Missing stored row table");
      const mechanics = prepareLogicalRelationalTableMechanics(table, schema.capabilities);
      const policy = Result.getOrThrow(bindPreparedLogicalRelationalRows(mechanics, rowFailure));
      const fields = Result.getOrThrow(policy.normalize({ code: "STORED", symbol: "S", symbol_native: "S", name: "Stored",
        rounding: "0", raw_rounding: { value: "0", precision: 20, signed: -0 } }, null, "2026-10-10T00:00:00.000Z"));
      const tableId = CatalogTableIdSchema.make(1), rowId = decodeAppRowIdHexV1("00000000000000000000000000000003");
      const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId }), creationTime = AppCreationTimeV1Schema.make(1);
      const read = (document: CanonicalFlarexValueV1) => decodeStoredAppDocumentEvidenceEffect({
          tableId, rowId, creationTime, codecVersion: document.codecVersion, canonicalBytes: document.canonicalBytes, sha256: document.sha256,
        });
      const bytes = yield* canonicalizeFlarexValueV1Effect({ ...fields, _id: documentId, _creationTime: creationTime }, "appDocument");
      const stored = yield* read(bytes);
      expect(Result.getOrThrow(inspectStoredAppDocumentEvidence(stored))?.runtime).toBe(stored.value);
      // Ingestion precedes the real JSON/table accepting frontier. The decoder
      // transfers provenance into its own detached copy, never a caller clone.
      const ingested = detachLogicalCanonicalDocument(stored);
      expect(Result.getOrThrow(inspectStoredAppDocumentEvidence(ingested))?.runtime).toBe(ingested.value);
      expect(captureLogicalRelationalCanonicalRow(ingested, 1, rowFailure))
        .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      const ingestedOutput = Result.getOrThrow(captureLogicalRelationalCanonicalRow(ingested, 65_536, rowFailure));
      expect(Result.getOrThrow(captureLogicalRelationalCanonicalRow(ingested, 65_536, rowFailure)).value).toBe(ingestedOutput.value);
      const copiedIngestion = detachLogicalCanonicalDocument(structuredClone(stored));
      expect(Result.getOrThrow(inspectStoredAppDocumentEvidence(copiedIngestion))).toBeUndefined();
      const output = Result.getOrThrow(captureLogicalRelationalCanonicalRow(stored, 65_536, rowFailure));
      if (!isJsonObject(output.value)) throw new Error("Missing stored runtime capture");
      const raw = output.value.raw_rounding;
      if (raw === undefined || !isJsonObject(raw)) throw new Error("Missing stored raw numeric companion");
      expect(Object.is(raw.signed, -0)).toBe(true);
      expect(stored.valueJson).not.toEqual(output.value);
      expect(Result.getOrThrow(captureLogicalRelationalCanonicalRow(stored, 65_536, rowFailure)).value).toBe(output.value);
      const query = Result.getOrThrow(compileLogicalRelationalRead(table, schema.capabilities,
        { fields: ["code"], order: { column: "code", direction: "asc" } }, 10, rowFailure, mechanics));
      expect(Result.getOrThrow(query.inspect(output.value, stored)).matches).toBe(true);
      const native = Result.getOrThrow(nativeLogicalRelationalCanonicalRow(mechanics, stored, 65_536, rowFailure));
      expect(native.raw_rounding).toBe(output.value.raw_rounding);
      const detached = detachLogicalCanonicalDocument(stored);
      expect(Result.getOrThrow(captureLogicalRelationalCanonicalRow(detached, 65_536, rowFailure)).value).toBe(output.value);
      expect(Result.getOrThrow(inspectLogicalRelationalCanonicalRow(mechanics, detached, output.value, "storedCorruption"))).toBe(native);
      const foreign = Object.freeze({ ...stored });
      const foreignOutput = Result.getOrThrow(captureLogicalRelationalCanonicalRow(foreign, 65_536, rowFailure));
      expect(foreignOutput.value).not.toBe(output.value);
      if (!isJsonObject(foreignOutput.value)) throw new Error("Missing foreign captured row");
      expect(Result.getOrThrow(inspectLogicalRelationalCanonicalRow(mechanics, foreign, foreignOutput.value, "storedCorruption"))).toBeUndefined();
      const policyValue = Result.getOrThrow(captureLogicalRelationalActivityJson(stored, rowFailure)).value;
      expect(policyValue).toEqual(stored.valueJson);
      expect(Result.getOrThrow(captureLogicalRelationalActivityJson(stored, rowFailure)).value).toBe(policyValue);
      const badBytes = yield* canonicalizeFlarexValueV1Effect({ ...fields, decimal_digits: "hidden-bad-field",
        _id: documentId, _creationTime: creationTime }, "appDocument");
      const badStored = yield* read(badBytes);
      // Capture/budget refusal still precedes the original semantic inspection.
      expect(captureLogicalRelationalCanonicalRow(badStored, 1, rowFailure))
        .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
      const badOutput = Result.getOrThrow(captureLogicalRelationalCanonicalRow(badStored, 65_536, rowFailure));
      if (!isJsonObject(badOutput.value)) throw new Error("Missing bad stored runtime capture");
      expect(query.inspect(badOutput.value, badStored)).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      expect(query.inspect(badOutput.value, badStored)).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      stored.sha256.fill(0);
      expect(captureLogicalRelationalCanonicalRow(stored, 65_536, rowFailure))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      expect(query.inspect(output.value, stored)).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
      expect(captureLogicalRelationalActivityJson(stored, rowFailure))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    })));

  it("enforces the aggregate decode budget at its exact boundary", () => {
    expect(MAX_RELATIONAL_SCHEMA_DECODE_UNITS).toBe(16_000);
    expect(Result.isSuccess(
      normalizeRelationalSchema(aggregateBudgetInput(false)),
    )).toBe(true);
    const overflow = normalizeRelationalSchema(aggregateBudgetInput(true));
    expect(Result.isFailure(overflow)).toBe(true);
    if (Result.isFailure(overflow)) {
      expect(overflow.failure).toMatchObject({
        _tag: "RelationalSchemaError",
        operation: "normalize",
        reason: "invalidInput",
      });
    }
  });

  it("canonicalizes unordered definitions, searchable members, and provenance paths", async () => {
    const firstInput = currencyInput();
    const secondInput = currencyInput();
    secondInput.tables.reverse();
    secondInput.tables[0]?.columns.reverse();
    secondInput.tables[0]?.keys.reverse();
    secondInput.tables[0]?.indexes.reverse();
    secondInput.capabilities.reverse();
    const searchable = secondInput.capabilities.find(
      capability => capability.kind === "searchableText",
    );
    searchable?.columns?.reverse();

    const first = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: firstInput,
      provenance: currencyProvenance(),
    }));
    const secondProvenance = currencyProvenance();
    secondProvenance.paths.reverse();
    const second = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: secondInput,
      provenance: secondProvenance,
    }));

    expect(second.schema).toEqual(first.schema);
    expect(second.artifact.canonicalJson).toBe(first.artifact.canonicalJson);
    expect(second.artifact.identity.artifactSha256).toBe(
      first.artifact.identity.artifactSha256,
    );

    const firstSyntheticInput = syntheticInput();
    const secondSyntheticInput = syntheticInput();
    secondSyntheticInput.tables.reverse();
    for (const table of secondSyntheticInput.tables) {
      table.columns.reverse();
      table.keys.reverse();
      table.indexes.reverse();
      table.constraints.reverse();
      table.relationships.reverse();
    }
    const firstSynthetic = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: firstSyntheticInput,
      provenance: { kind: "synthetic", fixtureId: "definition-order" },
    }));
    const secondSynthetic = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: secondSyntheticInput,
      provenance: { kind: "synthetic", fixtureId: "definition-order" },
    }));
    expect(secondSynthetic.schema).toEqual(firstSynthetic.schema);
    expect(secondSynthetic.artifact.canonicalJson).toBe(
      firstSynthetic.artifact.canonicalJson,
    );
    expect(secondSynthetic.artifact.identity.artifactSha256).toBe(
      firstSynthetic.artifact.identity.artifactSha256,
    );
  });

  it("composes one fixed framework artifact codec and derives required capabilities", async () => {
    const captured = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: currencyInput(),
      provenance: currencyProvenance(),
    }));

    expect(captured.artifact.identity).toMatchObject({
      deploymentId: "deployment-main",
      owner: "medusa",
      lineageId: "commerce",
    });
    expect(captured.artifact.codec).toEqual({
      format: "flarex.relational-schema",
      version: 1,
    });
    expect(captured.artifact.provenance).toEqual({
      kind: "sourceSnapshot",
      repository: "https://github.com/agmmdotdev/medusa-fork.git",
      revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
      paths: [
        "packages/core/utils/src/dml/helpers/entity-builder/create-big-number-properties.ts",
        "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts",
        "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts",
        "packages/modules/currency/src/models/currency.ts",
      ],
    });
    expect(captured.artifact.payload).toEqual(captured.schema);
    expect(captured.artifact.capabilities).toContain(
      "relational-schema.persistence.searchableText",
    );
    expect(captured.artifact.capabilities).toContain(
      "relational-schema.index-predicate.isNull",
    );
    expect(captured.artifact.capabilities).not.toContain(
      "relational-schema.relationship.manyToMany",
    );
  });

  it("pins the minimal outer canonical frame and SHA-256 compatibility vector", async () => {
    const captured = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      schema: minimalInput(),
      provenance: { kind: "synthetic", fixtureId: "golden" },
    }));

    expect(captured.artifact.canonicalJson).toBe(GOLDEN_CANONICAL_JSON);
    expect(captured.artifact.identity.artifactSha256).toBe(GOLDEN_SHA256);
  });

  it("detaches and recursively freezes every retained schema value", () => {
    const input = currencyInput();
    const schema = Result.getOrThrow(normalizeRelationalSchema(input));
    input.tables.reverse();
    input.tables[0]?.columns.reverse();
    input.capabilities.reverse();

    expect(schema.tables[0]?.identity.tableId).toBe("currency");
    expect(schema.tables[0]?.columns[0]?.identity.columnId).toBe("code");
    expect(schema.capabilities[0]?.identity.capabilityId)
      .toBe("currency.exact-number");
    expectDeeplyFrozen(schema);
  });

  it("rejects unsupported owners, types, relationships, and actions deterministically", () => {
    const application = minimalInput();
    Reflect.set(application, "owner", "application");
    expectUnsupported(application, "$.owner", "application");

    const malformedOwner = minimalInput();
    Reflect.set(malformedOwner, "owner", 42);
    expectInvalid(malformedOwner, "$.owner");

    const unsupportedColumn = minimalInput();
    Reflect.set(unsupportedColumn.tables[0]?.columns[0] ?? {}, "type", "float");
    expectUnsupported(unsupportedColumn, "$.tables[0].columns[0].type", "float");

    const malformedColumnType = minimalInput();
    Reflect.set(malformedColumnType.tables[0]?.columns[0] ?? {}, "type", null);
    expectInvalid(malformedColumnType, "$.tables[0].columns[0].type");

    const pivot = syntheticInput();
    Reflect.set(
      pivot.tables[0]?.relationships[0] ?? {},
      "kind",
      "manyToMany",
    );
    expectUnsupported(
      pivot,
      "$.tables[0].relationships[0].kind",
      "manyToMany",
    );

    const cascade = syntheticInput();
    Reflect.set(cascade.tables[0]?.constraints[0] ?? {}, "onDelete", "setNull");
    expectUnsupported(
      cascade,
      "$.tables[0].constraints[0].onDelete",
      "setNull",
    );
  });

  it("rejects duplicate identities, dangling references, and invalid physical semantics", () => {
    const duplicateColumn = minimalInput();
    const firstColumn = duplicateColumn.tables[0]?.columns[0];
    if (firstColumn === undefined) throw new Error("Fixture lost its column.");
    duplicateColumn.tables[0]?.columns.push({ ...firstColumn });
    expectInvalid(duplicateColumn, "$.tables[only].columns");

    const danglingForeignKey = syntheticInput();
    const foreignKey = danglingForeignKey.tables[0]?.constraints[0];
    const target = foreignKey?.targetColumns?.[0];
    if (target === undefined) throw new Error("Fixture lost its foreign key.");
    Reflect.set(target, "tableId", "missing");
    expectInvalid(
      danglingForeignKey,
      "$.tables[child].constraints[child.parent].targetColumns",
    );

    const nullablePrimary = minimalInput();
    Reflect.set(nullablePrimary.tables[0]?.columns[0] ?? {}, "nullable", true);
    expectInvalid(nullablePrimary, "$.tables[only].keys[only.primary]");

    const mismatchedDefault = minimalInput();
    Reflect.set(mismatchedDefault.tables[0]?.columns[0] ?? {}, "default", {
      kind: "integerLiteral",
      value: 0,
    });
    expectInvalid(mismatchedDefault, "$.tables[only].columns[id].default");
  });

  it("rejects malformed records and provenance before artifact hashing", async () => {
    const extraRoot = minimalInput();
    Reflect.set(extraRoot, "format", "caller-controlled");
    expectInvalid(extraRoot, "$");

    const accessor = minimalInput();
    Object.defineProperty(accessor.tables[0]?.columns[0] ?? {}, "type", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectInvalid(accessor, "$.tables[0].columns[0]");

    const duplicatePaths = currencyProvenance();
    duplicatePaths.paths.push(duplicatePaths.paths[0] ?? "missing");
    const failure = await runEffectFailure(captureRelationalSchemaArtifact({
      deploymentId: "deployment-main",
      schema: currencyInput(),
      provenance: duplicatePaths,
    }));
    expect(failure).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "composeArtifact",
      reason: "invalidInput",
      path: "$.provenance.paths",
    });

    const unsupportedProvenance = await runEffectFailure(
      captureRelationalSchemaArtifact({
        deploymentId: "deployment-main",
        schema: minimalInput(),
        provenance: { kind: "future-source" },
      }),
    );
    expect(unsupportedProvenance).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "composeArtifact",
      reason: "unsupportedCapability",
      path: "$.provenance.kind",
      capability: "future-source",
    });

    const malformedProvenance = await runEffectFailure(
      captureRelationalSchemaArtifact({
        deploymentId: "deployment-main",
        schema: minimalInput(),
        provenance: { kind: 42 },
      }),
    );
    expect(malformedProvenance).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "composeArtifact",
      reason: "invalidInput",
      path: "$.provenance.kind",
    });

    let lengthReads = 0;
    let synthesizedIndexReads = 0;
    const changingLengthPaths = new Proxy<string[]>([], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads <= 2 ? 0 : 2;
        }
        return Reflect.get(target, property, receiver);
      },
      ownKeys() {
        return ["length"];
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === "0" || property === "1") {
          synthesizedIndexReads += 1;
          return {
            configurable: true,
            enumerable: true,
            value: `path-${property}`,
            writable: true,
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const changingLengthFailure = await runEffectFailure(
      captureRelationalSchemaArtifact({
        deploymentId: "deployment-main",
        schema: minimalInput(),
        provenance: {
          kind: "sourceSnapshot",
          repository: "repo",
          revision: "revision",
          paths: changingLengthPaths,
        },
      }),
    );
    expect(changingLengthFailure).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "composeArtifact",
      reason: "invalidInput",
      path: "$.provenance.paths",
    });
    expect(lengthReads).toBe(0);
    expect(synthesizedIndexReads).toBe(0);
  });

  it("delegates hashing failures to the existing framework artifact boundary", async () => {
    vi.stubGlobal("crypto", undefined);
    const failure = await runEffectFailure(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      schema: minimalInput(),
      provenance: { kind: "synthetic", fixtureId: "hash-failure" },
    }));

    expect(failure).toMatchObject({
      _tag: "FrameworkSchemaArtifactError",
      operation: "capture",
      reason: "resourceFailure",
      message: "Framework schema artifact SHA-256 failed",
    });
  });
});

const GOLDEN_CANONICAL_JSON =
  '{"capabilities":["relational-schema","relational-schema.column.text",' +
  '"relational-schema.key.primary"],"dependencies":[],' +
  '"deploymentId":"deployment-a","format":"flarex.framework-schema-artifact",' +
  '"lineageId":"relational-core","owner":"system","payload":{' +
  '"capabilities":[],"coordinate":{"lineageId":"relational-core",' +
  '"owner":"system"},"format":"flarex.relational-schema","tables":[{' +
  '"columns":[{"default":{"kind":"none"},"identity":{"columnId":"id",' +
  '"lineageId":"relational-core","owner":"system","tableId":"only"},' +
  '"nullable":false,"origin":{"kind":"synthetic",' +
  '"sourceId":"golden.table.id"},"type":"text"}],"constraints":[],' +
  '"identity":{"lineageId":"relational-core","owner":"system",' +
  '"tableId":"only"},"indexes":[],"keys":[{"columns":[{' +
  '"columnId":"id","lineageId":"relational-core","owner":"system",' +
  '"tableId":"only"}],"identity":{"keyId":"only.primary",' +
  '"lineageId":"relational-core","owner":"system","tableId":"only"},' +
  '"kind":"primary","origin":{"kind":"synthetic",' +
  '"sourceId":"golden.table.primary"}}],"origin":{"kind":"synthetic",' +
  '"sourceId":"golden.table"},"relationships":[]}],"version":1},' +
  '"payloadCodec":{"format":"flarex.relational-schema","version":1},' +
  '"provenance":{"fixtureId":"golden","kind":"synthetic"},"version":1}';
const GOLDEN_SHA256 =
  "4a71c9b158b5978f10858cd093a70f2bbd7b69919f504022888a10890362ce8b";

function minimalInput() {
  return {
    owner: "system",
    lineageId: "relational-core",
    tables: [{
      tableId: "only",
      origin: synthetic("golden.table"),
      columns: [{
        columnId: "id",
        type: "text",
        nullable: false,
        default: { kind: "none" },
        origin: synthetic("golden.table.id"),
      }],
      keys: [{
        keyId: "only.primary",
        kind: "primary",
        columns: ["id"],
        origin: synthetic("golden.table.primary"),
      }],
      indexes: [],
      constraints: [],
      relationships: [],
    }],
    capabilities: [],
  };
}

function minimalIntegerInput(value: number) {
  const input = minimalInput();
  Reflect.set(input.tables[0]?.columns[0] ?? {}, "type", "integer");
  Reflect.set(input.tables[0]?.columns[0] ?? {}, "default", {
    kind: "integerLiteral",
    value,
  });
  return input;
}

function compositeRelationshipInput() {
  return {
    owner: "system",
    lineageId: "composite-cardinality",
    tables: [
      {
        tableId: "child",
        origin: synthetic("composite.child"),
        columns: [
          scalarColumn("id", "text", synthetic("composite.child.id")),
          scalarColumn(
            "left_ref",
            "text",
            synthetic("composite.child.left_ref"),
          ),
          scalarColumn(
            "right_ref",
            "text",
            synthetic("composite.child.right_ref"),
          ),
        ],
        keys: [
          primaryKey("child.primary", ["id"], "fixture.child.primary"),
          {
            keyId: "child.parent-pair",
            kind: "unique",
            columns: ["right_ref", "left_ref"],
            origin: synthetic("composite.child.parent-pair"),
          },
        ],
        indexes: [],
        constraints: [{
          constraintId: "child.parent",
          kind: "foreignKey",
          sourceColumns: ["left_ref", "right_ref"],
          targetColumns: [
            { tableId: "parent", columnId: "left" },
            { tableId: "parent", columnId: "right" },
          ],
          onDelete: "restrict",
          onUpdate: "restrict",
          origin: synthetic("composite.child.parent"),
        }],
        relationships: [{
          relationshipId: "child.parent",
          kind: "oneToOne",
          foreignKeyConstraintId: "child.parent",
          origin: synthetic("composite.child.parent-relation"),
        }],
      },
      {
        tableId: "parent",
        origin: synthetic("composite.parent"),
        columns: [
          scalarColumn("id", "text", synthetic("composite.parent.id")),
          scalarColumn("left", "text", synthetic("composite.parent.left")),
          scalarColumn("right", "text", synthetic("composite.parent.right")),
        ],
        keys: [
          primaryKey("parent.primary", ["id"], "fixture.parent.primary"),
          {
            keyId: "parent.pair",
            kind: "unique",
            columns: ["right", "left"],
            origin: synthetic("composite.parent.pair"),
          },
        ],
        indexes: [],
        constraints: [],
        relationships: [],
      },
    ],
    capabilities: [],
  };
}

function aggregateBudgetInput(overflow: boolean) {
  const tables: unknown[] = [];
  for (let tableIndex = 0; tableIndex < 31; tableIndex += 1) {
    const tableId = `budget-${String(tableIndex).padStart(2, "0")}`;
    const indexCount = tableIndex === 0 && !overflow ? 255 : 256;
    const columns: unknown[] = [
      scalarColumn("id", "text", synthetic(`${tableId}.id`)),
    ];
    if (tableIndex === 0) {
      columns.push(
        timestampColumn("created_at", false, "currentTimestamp", tableId),
        timestampColumn("updated_at", false, "currentTimestamp", tableId),
      );
    }
    const indexes: unknown[] = [];
    for (let index = 0; index < indexCount; index += 1) {
      indexes.push({
        indexId: `${tableId}.index-${String(index).padStart(3, "0")}`,
        kind: "btree",
        columns: ["id"],
        predicate: null,
        origin: synthetic(`${tableId}.index-${String(index)}`),
      });
    }
    tables.push({
      tableId,
      origin: synthetic(tableId),
      columns,
      keys: [primaryKey(
        `${tableId}.primary`,
        ["id"],
        `fixture.${tableId}.primary`,
      )],
      indexes,
      constraints: [],
      relationships: [],
    });
  }
  const capabilities: unknown[] = [{
    capabilityId: "budget.timestamps",
    kind: "managedTimestamps",
    createdAtColumn: { tableId: "budget-00", columnId: "created_at" },
    updatedAtColumn: { tableId: "budget-00", columnId: "updated_at" },
    updateBehavior: "currentTimestampOnUpdate",
    origin: implicit("budget.timestamps"),
  }];
  return {
    owner: "system",
    lineageId: "aggregate-budget",
    tables,
    capabilities,
  };
}

function syntheticInput() {
  return {
    owner: "system",
    lineageId: "relational-core",
    tables: [
      {
        tableId: "child",
        origin: synthetic("fixture.child"),
        columns: [
          scalarColumn("id", "text", synthetic("fixture.child.id")),
          scalarColumn(
            "parent_id",
            "text",
            synthetic("fixture.child.parent_id"),
          ),
          scalarColumn(
            "alternate_parent_id",
            "text",
            synthetic("fixture.child.alternate_parent_id"),
          ),
          {
            columnId: "ordinal",
            type: "integer",
            nullable: false,
            default: { kind: "integerLiteral", value: 0 },
            origin: synthetic("fixture.child.ordinal"),
          },
        ],
        keys: [
          primaryKey("child.primary", ["id"], "fixture.child.primary"),
          {
            keyId: "child.parent-ordinal",
            kind: "unique",
            columns: ["parent_id", "ordinal"],
            origin: synthetic("fixture.child.parent-ordinal"),
          },
        ],
        indexes: [
          {
            indexId: "child.parent-lookup",
            kind: "btree",
            columns: ["parent_id"],
            predicate: null,
            origin: synthetic("fixture.child.parent-lookup"),
          },
          {
            indexId: "child.alternate-lookup",
            kind: "btree",
            columns: ["alternate_parent_id"],
            predicate: null,
            origin: synthetic("fixture.child.alternate-lookup"),
          },
        ],
        constraints: [
          {
            constraintId: "child.parent",
            kind: "foreignKey",
            sourceColumns: ["parent_id"],
            targetColumns: [{ tableId: "parent", columnId: "id" }],
            onDelete: "restrict",
            onUpdate: "restrict",
            origin: synthetic("fixture.child.parent"),
          },
          {
            constraintId: "child.alternate-parent",
            kind: "foreignKey",
            sourceColumns: ["alternate_parent_id"],
            targetColumns: [{ tableId: "parent", columnId: "id" }],
            onDelete: "restrict",
            onUpdate: "restrict",
            origin: synthetic("fixture.child.alternate-parent"),
          },
          {
            constraintId: "child.ordinal-range",
            kind: "integerRange",
            columnId: "ordinal",
            minimum: 0,
            maximum: null,
            origin: synthetic("fixture.child.ordinal-range"),
          },
        ],
        relationships: [
          {
            relationshipId: "child.parent",
            kind: "manyToOne",
            foreignKeyConstraintId: "child.parent",
            origin: synthetic("fixture.child.parent-relation"),
          },
          {
            relationshipId: "child.alternate-parent",
            kind: "manyToOne",
            foreignKeyConstraintId: "child.alternate-parent",
            origin: synthetic("fixture.child.alternate-parent-relation"),
          },
        ],
      },
      {
        tableId: "parent",
        origin: synthetic("fixture.parent"),
        columns: [
          scalarColumn("id", "text", synthetic("fixture.parent.id")),
          scalarColumn("slug", "text", synthetic("fixture.parent.slug")),
        ],
        keys: [
          primaryKey("parent.primary", ["id"], "fixture.parent.primary"),
          {
            keyId: "parent.slug",
            kind: "unique",
            columns: ["slug"],
            origin: synthetic("fixture.parent.slug"),
          },
        ],
        indexes: [],
        constraints: [],
        relationships: [],
      },
    ],
    capabilities: [],
  };
}

function currencyInput() {
  const modelSource =
    "packages/modules/currency/src/models/currency.ts#currency";
  const implicitSource =
    "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts";
  return {
    owner: "medusa",
    lineageId: "commerce",
    tables: [{
      tableId: "currency",
      origin: authored(modelSource),
      columns: [
        scalarColumn("code", "text", authored(`${modelSource}.code`)),
        scalarColumn("symbol", "text", authored(`${modelSource}.symbol`)),
        scalarColumn(
          "symbol_native",
          "text",
          authored(`${modelSource}.symbol_native`),
        ),
        scalarColumn("name", "text", authored(`${modelSource}.name`)),
        {
          columnId: "decimal_digits",
          type: "integer",
          nullable: false,
          default: { kind: "integerLiteral", value: 0 },
          origin: authored(`${modelSource}.decimal_digits`),
        },
        {
          columnId: "rounding",
          type: "numeric",
          nullable: false,
          default: { kind: "exactNumericLiteral", value: "0" },
          origin: authored(`${modelSource}.rounding`),
        },
        {
          columnId: "raw_rounding",
          type: "jsonb",
          nullable: false,
          default: {
            kind: "exactNumericRawLiteral",
            value: "0",
            precision: 20,
          },
          origin: derived("dml.big-number.raw_rounding"),
        },
        timestampColumn("created_at", false, "currentTimestamp", implicitSource),
        timestampColumn("updated_at", false, "currentTimestamp", implicitSource),
        timestampColumn("deleted_at", true, "none", implicitSource),
      ],
      keys: [primaryKey(
        "currency.primary",
        ["code"],
        `${modelSource}.code.primaryKey`,
      )],
      indexes: [{
        indexId: "currency.active",
        kind: "btree",
        columns: ["deleted_at"],
        predicate: { kind: "isNull", columnId: "deleted_at" },
        origin: implicit("dml.deleted_at.active-index"),
      }],
      constraints: [],
      relationships: [],
    }],
    capabilities: [
      {
        capabilityId: "currency.searchable",
        kind: "searchableText",
        columns: [
          { tableId: "currency", columnId: "code" },
          { tableId: "currency", columnId: "name" },
        ],
        origin: authored(`${modelSource}.searchable`),
      },
      {
        capabilityId: "currency.exact-number",
        kind: "exactNumericCompanion",
        numericColumn: { tableId: "currency", columnId: "rounding" },
        rawColumn: { tableId: "currency", columnId: "raw_rounding" },
        origin: derived("dml.big-number.companion"),
      },
      {
        capabilityId: "currency.timestamps",
        kind: "managedTimestamps",
        createdAtColumn: { tableId: "currency", columnId: "created_at" },
        updatedAtColumn: { tableId: "currency", columnId: "updated_at" },
        updateBehavior: "currentTimestampOnUpdate",
        origin: implicit("dml.managed-timestamps"),
      },
      {
        capabilityId: "currency.soft-delete",
        kind: "softDelete",
        deletedAtColumn: { tableId: "currency", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "currency", indexId: "currency.active" },
        origin: implicit("dml.soft-delete"),
      },
    ],
  };
}

function currencyProvenance() {
  return {
    kind: "sourceSnapshot",
    repository: "https://github.com/agmmdotdev/medusa-fork.git",
    revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
    paths: [
      "packages/modules/currency/src/models/currency.ts",
      "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts",
      "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts",
      "packages/core/utils/src/dml/helpers/entity-builder/create-big-number-properties.ts",
    ],
  };
}

function scalarColumn(
  columnId: string,
  type: string,
  origin: Readonly<{ kind: string; sourceId: string }>,
) {
  return {
    columnId,
    type,
    nullable: false,
    default: { kind: "none" },
    origin,
  };
}

function timestampColumn(
  columnId: string,
  nullable: boolean,
  defaultKind: string,
  sourceId: string,
) {
  return {
    columnId,
    type: "timestamptz",
    nullable,
    default: { kind: defaultKind },
    origin: implicit(`${sourceId}#${columnId}`),
  };
}

function primaryKey(keyId: string, columns: string[], sourceId: string) {
  return {
    keyId,
    kind: "primary",
    columns,
    origin: sourceId.startsWith("fixture.")
      ? synthetic(sourceId)
      : authored(sourceId),
  };
}

function authored(sourceId: string) {
  return { kind: "authored", sourceId };
}

function derived(sourceId: string) {
  return { kind: "derived", sourceId };
}

function implicit(sourceId: string) {
  return { kind: "implicit", sourceId };
}

function synthetic(sourceId: string) {
  return { kind: "synthetic", sourceId };
}

function expectInvalid(input: unknown, path: string): void {
  const result = normalizeRelationalSchema(input);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "normalize",
      reason: "invalidInput",
      path,
      retryable: false,
    });
  }
}

function expectUnsupported(
  input: unknown,
  path: string,
  capability: string,
): void {
  const result = normalizeRelationalSchema(input);
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toMatchObject({
      _tag: "RelationalSchemaError",
      operation: "normalize",
      reason: "unsupportedCapability",
      path,
      capability,
      retryable: false,
    });
  }
}

function expectDeeplyFrozen(input: unknown): void {
  if (input === null || typeof input !== "object") return;
  expect(Object.isFrozen(input)).toBe(true);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeeplyFrozen(descriptor.value);
    }
  }
}
