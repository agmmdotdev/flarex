import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
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
const commitSeq = CommitSeqSchema.make(9007199254740993n);
const scopeUuid = ScopeUuidV1Schema.make("11111111-1111-4111-8111-111111111111");
const tableId = CatalogTableIdSchema.make(1);
const rowId = new Uint8Array(16).fill(4);
export const row = {
  scopeUuid, tableId, rowId, commitSeq, prevCommitSeq: null,
  writeEpochUuid: ScopeEpochUuidV1Schema.make("22222222-2222-4222-8222-222222222222"),
  schemaVersionId: CatalogSchemaVersionIdSchema.make("publication-compiler"),
  creationTime: AppCreationTimeV1Schema.make(1700000000000.25),
  valueCodecVersion: FlarexValueCodecVersionSchema.make(1), isTombstone: false,
  valueBytes: CanonicalFlarexValueBytesV1Schema.make(new Uint8Array([1, 2, 3])),
  valueSha256: FlarexValueSha256V1Schema.make(new Uint8Array(32).fill(5)),
} satisfies ApplicationMaterializationValues["rows"][number];

export function values(count: number): ApplicationMaterializationValues {
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
export function nativeTail(value: ApplicationMaterializationValues, schemaName: string): SQL {
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
