import { getTableColumns, sql, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable, pgTable, timestamp } from "drizzle-orm/pg-core";
import { CasingCache } from "drizzle-orm/casing";
import { Client } from "pg";
import { expect, it, vi } from "vitest";
import { CatalogIndexIdSchema, CatalogTableIdSchema, CatalogIndexDefinitionIdSchema, CatalogUniqueConstraintDefinitionIdSchema } from "flarex-protocol/catalog";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeUuidV1Schema, ScopeEpochUuidV1Schema, ScopeIdSchema, ScopeEpochSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { IndexBuildAttemptFenceSchema } from "flarex-protocol/index-build-state";
import { AppUniqueConstraintSetBuildAttemptFenceV1Schema } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { OrderedIndexKeyCodecVersionSchema } from "flarex-protocol/ordered-index";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { FlarexValueCodecVersionSchema, CanonicalFlarexValueBytesV1Schema, FlarexValueSha256V1Schema } from "flarex-protocol/value";
import { fxAppRowRevisions, fxAppIndexEntryRevisions, fxAppUniqueKeys, fxAppSearchEntryCurrent, fxAppJsonEntryCurrent } from "../../../src/database/schema";
import { applicationIndexCoverageArray, applicationUniqueCoverageArray, type ApplicationMaterializationValues } from "../../../src/storage/materialization/domainApplication";
import { buildApplicationPublicationStatement } from "../../../src/storage/materialization/domainPublicationSql";
import { makePhysicalSessionAccess } from "../../../src/database/physicalSession/drizzle";
import { observeDrizzleRawQuery } from "../../../src/database/drizzleQueryObservation";

const dialect = new PgDialect();
const commitSeq = CommitSeqSchema.make(9007199254740993n);
const scopeUuid = ScopeUuidV1Schema.make("11111111-1111-4111-8111-111111111111");
const tableId = CatalogTableIdSchema.make(1);
const rowId = new Uint8Array(16).fill(4);
const row = {
  scopeUuid, tableId, rowId, commitSeq, prevCommitSeq: null,
  writeEpochUuid: ScopeEpochUuidV1Schema.make("22222222-2222-4222-8222-222222222222"),
  schemaVersionId: CatalogSchemaVersionIdSchema.make("publication-compiler"),
  creationTime: AppCreationTimeV1Schema.make(1700000000000.25),
  valueCodecVersion: FlarexValueCodecVersionSchema.make(1), isTombstone: false,
  valueBytes: CanonicalFlarexValueBytesV1Schema.make(new Uint8Array([1, 2, 3])),
  valueSha256: FlarexValueSha256V1Schema.make(new Uint8Array(32).fill(5)),
} satisfies ApplicationMaterializationValues["rows"][number];

function values(count: number): ApplicationMaterializationValues {
  const logicalIndexId = CatalogIndexIdSchema.make(2);
  const indexDefinitionId = CatalogIndexDefinitionIdSchema.make(3);
  const constraintId = CatalogUniqueConstraintDefinitionIdSchema.make(4);
  const keyCodecVersion = OrderedIndexKeyCodecVersionSchema.make(1);
  const unique = { scopeUuid, constraintId, localeKey: "locale", canonicalKeySha256: new Uint8Array(32).fill(8),
    keyCodecVersion, encodedKey: new Uint8Array([9, 8]), tableId, rowId };
  const coverage = { scopeId: ScopeIdSchema.make("publication-scope"), epoch: ScopeEpochSchema.make("publication-epoch"),
    storageGenerationFence: StorageGenerationFenceSchema.make(3n) };
  const definition = { kind: "jsonContainment" as const, tableId, logicalIndexId,
    sourceSha256: "a".repeat(64), columns: ["attributes"], nullPredicateField: null };
  return { rows: Array.from({ length: count }, (_, index) => ({ ...row, prevCommitSeq: index === 0 ? null : CommitSeqSchema.make(2n) })),
    rowPages: count === 0 ? [] : [count],
    indexes: count === 0 ? [] : [{ row: { scopeUuid, indexDefinitionId, tableId, keyCodecVersion,
      physicalSpecSha256: new Uint8Array(32).fill(6), encodedKey: new Uint8Array([7]),
      keySha256: new Uint8Array(32).fill(7), rowId, commitSeq, isTombstone: false }, prior: null, historical: true }],
    unique: count === 0 ? { owners: [], previous: [], next: [] } : {
      owners: [{ scopeUuid, constraintId, localeKey: unique.localeKey, tableId, rowId, ordinal: 0 }], previous: [null], next: [unique] },
    validation: count === 0 ? [] : [{ ...coverage, indexDefinitionId, attemptFence: IndexBuildAttemptFenceSchema.make(4n) }],
    indexCoverage: count === 0 ? [] : [{ ...coverage, indexDefinitionId, attemptFence: IndexBuildAttemptFenceSchema.make(5n) }],
    uniqueCoverage: count === 0 ? [] : [{ ...coverage, uniqueConstraintDefinitionId: constraintId, attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(6n) }], commitSeq, scopeUuid,
    search: count === 0 ? [] : [{ scopeUuid, commitSeq, definition, ids: [rowId],
      textPages: [[{ scopeUuid, tableId, logicalIndexId, sourceSha256: definition.sourceSha256,
        fieldId: "title", rowId, commitSeq, foldedText: "quoted ' title" }]],
      jsonPages: [[{ scopeUuid, tableId, logicalIndexId, sourceSha256: definition.sourceSha256,
        fieldId: "attributes", rowId, commitSeq, valueJson: { quote: "a'\"b", number: 12, nested: [null, true] } }]],
      entryCount: 1, textBytes: 32 }] };
}

/** Independent reference uses the installed Drizzle SQL interpreter. It has no
 * admission, publication, settlement or alternate execution behavior. */
function nativeTail(value: ApplicationMaterializationValues, schemaName: string): SQL {
  const scalar = (values: readonly unknown[], type: string, encoder?: Parameters<typeof sql.param>[1]) =>
    sql`array[${sql.join(values.map(value => sql`${sql.param(value, encoder)}::${sql.raw(type)}`), sql`, `)}]::${sql.raw(type)}[]`;
  const tuples = <Table extends PgTable>(table: Table, typeName: string, values: readonly (Table["$inferInsert"] | null)[]) => {
    const type = sql`${sql.identifier(schemaName)}.${sql.identifier(typeName)}`;
    return sql`array[${sql.join(values.map(value => value === null ? sql`null::${type}` :
      sql`row(${sql.join(Object.entries(getTableColumns(table)).map(([key, column]) =>
        sql`${sql.param(value[key as keyof typeof value], column)}::${sql.raw(column.getSQLType())}`), sql`, `)})::${type}`), sql`, `)}]::${type}[]`;
  };
  const ownerType = sql`${sql.identifier(schemaName)}.fx_app_unique_owner`;
  const owners = sql`array[${sql.join(value.unique.owners.map(owner => sql`row(
    ${sql.param(owner.scopeUuid, fxAppUniqueKeys.scopeUuid)}::uuid,${sql.param(owner.constraintId, fxAppUniqueKeys.constraintId)}::integer,
    ${sql.param(owner.localeKey, fxAppUniqueKeys.localeKey)}::text,${sql.param(owner.tableId, fxAppUniqueKeys.tableId)}::integer,
    ${sql.param(owner.rowId, fxAppUniqueKeys.rowId)}::bytea)::${ownerType}`), sql`, `)}]::${ownerType}[]`;
  return sql`${tuples(fxAppRowRevisions, "fx_app_row_write", value.rows)},${scalar(value.rowPages, "integer")},
    ${tuples(fxAppIndexEntryRevisions, "fx_app_index_write", value.indexes.map(entry => entry.row))},
    ${scalar(value.indexes.map(entry => entry.prior), "bigint")},${scalar(value.indexes.map(entry => entry.historical), "boolean")},
    ${owners},${tuples(fxAppUniqueKeys, "fx_app_unique_write", value.unique.previous)},${tuples(fxAppUniqueKeys, "fx_app_unique_write", value.unique.next)},
    ${applicationIndexCoverageArray(value.validation, schemaName)},${applicationIndexCoverageArray(value.indexCoverage, schemaName)},
    ${applicationUniqueCoverageArray(value.uniqueCoverage, schemaName)},${sql.param(value.commitSeq, fxAppRowRevisions.commitSeq)}::bigint,
    ${sql.param(value.scopeUuid, fxAppRowRevisions.scopeUuid)}::uuid,
    ${scalar(value.search.map(search => search.definition.tableId), "integer", fxAppSearchEntryCurrent.tableId)},
    ${scalar(value.search.map(search => search.definition.logicalIndexId), "integer", fxAppSearchEntryCurrent.logicalIndexId)},
    ${scalar(value.search.map(search => search.definition.sourceSha256), "text", fxAppSearchEntryCurrent.sourceSha256)},
    ${scalar(value.search.map(search => search.definition.kind === "jsonContainment"), "boolean")},
    ${scalar(value.search.map(search => search.ids.length), "integer")},${scalar(value.search.flatMap(search => search.ids), "bytea", fxAppSearchEntryCurrent.rowId)},
    ${scalar(value.search.map(search => search.textPages.flat().length), "integer")},${tuples(fxAppSearchEntryCurrent, "fx_app_search_write", value.search.flatMap(search => search.textPages.flat()))},
    ${scalar(value.search.map(search => search.jsonPages.flat().length), "integer")},${tuples(fxAppJsonEntryCurrent, "fx_app_json_write", value.search.flatMap(search => search.jsonPages.flat()))}`;
}
const normalize = (statement: string) => statement.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").replace(/\s*::\s*/g, "::").replace(/\(\s+/g, "(").trim();
const projection = sql.raw("kind,coverage_ordinal,coverage_definition,coverage_attempt::text,coverage_epoch,coverage_fence::text,reason,row_count,index_count,unique_count,validation_count,coverage_count,search_count,search_build_count,intrinsic_count,intrinsic_live_count,intrinsic_tombstone_count,intrinsic_key_bytes,index_coverage_count,unique_coverage_count");

it.each([0, 1, 3])("preserves native publication SQL, casts, codecs and parameter order for %i rows", count => {
  const value = values(count); const schemaName = 'quoted"publication';
  const prefix = sql`${"prefix"}::text,${9n}::bigint`; const intrinsic = sql`${rowId}::bytea,${false}::boolean`;
  const actual = dialect.sqlToQuery(buildApplicationPublicationStatement(schemaName, prefix, intrinsic, "row", value));
  const expected = dialect.sqlToQuery(sql`select ${projection} from ${sql.identifier(schemaName)}.fx_apply_app_publication(
    ${prefix},${intrinsic},${"row"}::text,${nativeTail(value, schemaName)})`);
  expect(normalize(actual.sql)).toBe(normalize(expected.sql));
  expect(actual.params).toEqual(expected.params);
  expect(actual.typings).toEqual(expected.typings);
  expect(actual.params).toContain(commitSeq);
  if (count > 0) expect(actual.params).toContain(JSON.stringify(value.search[0]?.jsonPages[0]?.[0]?.valueJson));
});

it("retains null tuple positions and binds fresh parameters on every complete invocation", () => {
  const first = values(1); const second = { ...values(0), commitSeq: CommitSeqSchema.make(10n) };
  const withNull = { ...first, unique: { owners: [], previous: [null], next: [null] } };
  const compiled = dialect.sqlToQuery(buildApplicationPublicationStatement("first", sql`${1}`, sql`${2}`, null, withNull));
  expect(compiled.sql).toContain('array[null::"first"."fx_app_unique_write"]');
  expect(compiled.params.slice(0, 3)).toEqual([1, 2, null]);
  const next = dialect.sqlToQuery(buildApplicationPublicationStatement("second", sql`${3}`, sql`${4}`, null, second));
  expect(next.params).toEqual([3, 4, null, 10n, scopeUuid]);
  expect(next.sql).not.toContain('"first"');
  expect(compiled.params).toContain(commitSeq);
});

it("preserves first native encoder failure before intrinsic and later tuple work", () => {
  const probe = pgTable("publication_codec_probe", { time: timestamp({ withTimezone: true }) });
  const prefixFailure = new Error("prefix encoder failure"); const rowFailure = new Error("row encoder failure");
  const time = vi.spyOn(probe.time, "mapToDriverValue").mockImplementation(() => { throw prefixFailure; });
  const bytes = vi.spyOn(fxAppRowRevisions.rowId, "mapToDriverValue").mockImplementation(() => { throw rowFailure; });
  try {
    expect(() => dialect.sqlToQuery(buildApplicationPublicationStatement("public", sql`${sql.param(new Date(), probe.time)}`, sql`${2}`, null, values(2)))).toThrow(prefixFailure);
    expect(bytes).not.toHaveBeenCalled();
    expect(() => dialect.sqlToQuery(buildApplicationPublicationStatement("public", sql`${1}`, sql`${2}`, null, values(2)))).toThrow(rowFailure);
    expect(bytes).toHaveBeenCalledTimes(1);
  } finally { time.mockRestore(); bytes.mockRestore(); }
});

it("preserves native timestamp prefix and expression-returning codecs in the same dialect", () => {
  const probe = pgTable("publication_codec_probe", { time: timestamp({ withTimezone: true }) });
  const date = new Date("2026-10-10T01:02:03.456Z");
  const prefix = sql`${sql.param(date, probe.time)}::timestamptz`;
  const bytes = vi.spyOn(fxAppRowRevisions.rowId, "mapToDriverValue").mockReturnValue(sql`decode(${"0404"},'hex')`);
  try {
    const value = values(1);
    const actual = dialect.sqlToQuery(buildApplicationPublicationStatement("public", prefix, sql`${2}`, null, value));
    const expected = dialect.sqlToQuery(sql`select ${projection} from "public".fx_apply_app_publication(${prefix},${2},${null}::text,${nativeTail(value, "public")})`);
    expect(normalize(actual.sql)).toBe(normalize(expected.sql));
    expect(actual.params).toEqual(expected.params);
    expect(actual.params[0]).toBe(date.toISOString());
  } finally { bytes.mockRestore(); }
});

it("uses the actual dialect's initial positional offset through prefix, intrinsic and publication values", () => {
  const offset = { value: 17 };
  const statement = buildApplicationPublicationStatement("public", sql`${1}::integer`, sql`${2}::integer`, null, values(0));
  const actual = statement.toQuery({ casing: new CasingCache(), escapeName: name => dialect.escapeName(name),
    escapeParam: index => dialect.escapeParam(index), escapeString: value => dialect.escapeString(value), paramStartIndex: offset });
  expect(actual.sql).toContain("($18::integer,$19::integer,$20::text,");
  expect(actual.sql).toContain("$21::bigint, $22::uuid");
  expect(actual.params).toEqual([1, 2, null, commitSeq, scopeUuid]);
  expect(offset.value).toBe(22);
});

it("preserves undefined through the native codec and skips native encoding for null", () => {
  const codec = vi.spyOn(fxAppRowRevisions.valueBytes, "mapToDriverValue");
  try {
    const value = { ...values(0), rows: [{ ...row, valueBytes: undefined }, { ...row, valueBytes: null }] };
    const actual = dialect.sqlToQuery(buildApplicationPublicationStatement("public", sql`${1}`, sql`${2}`, null, value));
    const expected = dialect.sqlToQuery(sql`select ${projection} from "public".fx_apply_app_publication(${1},${2},${null}::text,${nativeTail(value, "public")})`);
    expect(actual.params).toEqual(expected.params);
    expect(codec.mock.calls).toEqual([[undefined], [undefined]]);
  } finally { codec.mockRestore(); }
});

it("routes the complete compiled statement through native tx.execute and detached raw query observation", () => {
  const tx = makePhysicalSessionAccess({})(new Client()).transaction;
  const statement = tx.execute(buildApplicationPublicationStatement("public", sql`${rowId}::bytea`, sql`${2}`, null, values(0)));
  const observer = vi.fn();
  observeDrizzleRawQuery("applyPublication", statement, observer);
  const query = statement.getQuery();
  expect(query.sql).toContain('from "public".fx_apply_app_publication($1::bytea,$2,$3::text,');
  expect(query.params).toEqual([rowId, 2, null, commitSeq, scopeUuid]);
  expect(observer).toHaveBeenCalledOnce();
  expect(observer.mock.calls[0]?.[0]).toEqual({ name: "applyPublication", sql: query.sql, params: query.params });
  expect(observer.mock.calls[0]?.[0].params[0]).not.toBe(rowId);
});
